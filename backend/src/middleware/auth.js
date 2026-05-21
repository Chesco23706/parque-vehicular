import { config } from '../config.js';
import { beginRlsRequest, get, run } from '../db.js';
import { audit } from '../audit.js';
import { cookieOptions, expiresInMinutes, hashToken, normalizeIp, normalizeUserAgent, sessionFingerprint } from '../security.js';

export async function authRequired(req, res, next) {
  const bearer = String(req.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1];
  const token = req.cookies?.pv_session || bearer;
  if (!token) return res.status(401).json({ message: 'Sesion requerida' });

  const session = await get(
    `SELECT s.*, u.id AS user_id, u.nombre, u.email, u.department_id, u.activo, r.nombre AS role
     FROM sesiones s
     JOIN usuarios u ON u.id = s.usuario_id
     JOIN roles r ON r.id = u.role_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
    [hashToken(token)]
  );
  if (!session || !session.activo || new Date(session.expires_at) <= new Date()) {
    if (session) await run('UPDATE sesiones SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?', [session.id]);
    res.clearCookie('pv_session', cookieOptions(0));
    return res.status(401).json({ message: 'Sesion expirada' });
  }

  const currentUserAgent = normalizeUserAgent(req);
  if (session.user_agent && session.user_agent !== currentUserAgent) {
    await run('UPDATE sesiones SET suspicious = true, revoked_at = CURRENT_TIMESTAMP WHERE id = ?', [session.id]);
    await audit({ ...req, user: { id: session.user_id } }, 'sesion_sospechosa', 'sesiones', session.id, { reason: 'user_agent_mismatch' });
    res.clearCookie('pv_session', cookieOptions(0));
    return res.status(401).json({ message: 'Sesion expirada' });
  }

  const currentFingerprint = sessionFingerprint(req);
  if (session.fingerprint && session.fingerprint !== currentFingerprint) {
    await run('UPDATE sesiones SET suspicious = true, revoked_at = CURRENT_TIMESTAMP WHERE id = ?', [session.id]);
    await audit({ ...req, user: { id: session.user_id } }, 'sesion_sospechosa', 'sesiones', session.id, { reason: 'fingerprint_mismatch' });
    res.clearCookie('pv_session', cookieOptions(0));
    return res.status(401).json({ message: 'Sesion expirada' });
  }

  const currentIp = normalizeIp(req);
  if (session.ip && session.ip !== currentIp) {
    const ipChangeCount = Number(session.ip_change_count || 0) + 1;
    const revokeSession = ipChangeCount > config.maxIpChangesPerSession;
    await run(
      `UPDATE sesiones
       SET suspicious = true, ip_change_count = ?, revoked_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE revoked_at END
       WHERE id = ?`,
      [ipChangeCount, revokeSession, session.id]
    );
    await audit({ ...req, user: { id: session.user_id } }, 'sesion_ip_cambiada', 'sesiones', session.id, { oldIp: session.ip, newIp: currentIp, ipChangeCount });

    if (revokeSession) {
      res.clearCookie('pv_session', cookieOptions(0));
      return res.status(401).json({ message: 'Sesion expirada' });
    }

    const suspiciousCount = await get(
      `SELECT COUNT(*) AS total FROM sesiones
       WHERE usuario_id = ? AND suspicious = true AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
      [session.user_id]
    );
    if (Number(suspiciousCount?.total || 0) >= config.maxSuspiciousSessionsPerUser) {
      await audit({ ...req, user: { id: session.user_id } }, 'sesiones_sospechosas_recurrentes', 'sesiones', session.id, { total: suspiciousCount.total });
    }
  }

  const nextExpiry = expiresInMinutes(config.sessionMinutes);
  await run('UPDATE sesiones SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ?, ip = ? WHERE id = ?', [nextExpiry, currentIp, session.id]);
  if (req.cookies?.pv_session) res.cookie('pv_session', token, cookieOptions(config.sessionMinutes * 60 * 1000));
  req.session = { id: session.id };
  req.user = {
    id: session.user_id,
    nombre: session.nombre,
    email: session.email,
    department_id: session.department_id,
    role: session.role
  };

  const rls = await beginRlsRequest(req.user.id);
  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    await rls.finish(commit).catch((error) => {
      console.error('No se pudo cerrar contexto RLS', error);
    });
  };

  res.on('finish', () => {
    finish(true);
  });
  res.on('close', () => {
    if (!res.writableEnded) finish(false);
  });

  rls.run(() => next());
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Permiso insuficiente' });
    next();
  };
}

export function canAccessDepartment(req, departmentId) {
  return req.user.role === 'admin' || Number(req.user.department_id) === Number(departmentId);
}
