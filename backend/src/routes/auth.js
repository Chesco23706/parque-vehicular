import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { all, get, run } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { userSchema } from '../validators.js';
import { cookieOptions, expiresInMinutes, hashToken, normalizeIp, normalizeUserAgent, randomToken, verifyTotp } from '../security.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos. Intenta más tarde.' }
});

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const user = await get(
    `SELECT u.*, r.nombre AS role FROM usuarios u JOIN roles r ON r.id = u.role_id
     WHERE lower(u.email) = lower(?) AND u.activo = true`,
    [email]
  );
  const genericMessage = 'Credenciales inválidas';
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    await audit({ ...req, user: { id: user.id } }, 'login_bloqueado', 'usuarios', user.id);
    return res.status(401).json({ message: genericMessage });
  }
  if (user && Number(user.failed_login_attempts || 0) >= 3 && config.captchaToken && req.get('x-captcha-token') !== config.captchaToken) {
    await audit({ ...req, user: { id: user.id } }, 'captcha_requerido', 'usuarios', user.id);
    return res.status(403).json({ message: 'Verificación adicional requerida', requiresCaptcha: true });
  }
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    if (user) {
      const attempts = Number(user.failed_login_attempts || 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await run('UPDATE usuarios SET failed_login_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lockedUntil, user.id]);
      await audit({ ...req, user: { id: user.id } }, 'login_fallido', 'usuarios', user.id, { attempts });
    } else {
      await audit(req, 'login_fallido_usuario_desconocido', 'usuarios', null, { email: String(email || '').slice(0, 120) });
    }
    return res.status(401).json({ message: genericMessage });
  }
  if (user.mfa_enabled && !verifyTotp(user.mfa_secret, req.body.mfa_code)) {
    await audit({ ...req, user }, 'mfa_fallido', 'usuarios', user.id);
    return res.status(401).json({ message: genericMessage, requiresMfa: true });
  }

  const token = randomToken();
  await run('UPDATE sesiones SET revoked_at = CURRENT_TIMESTAMP WHERE usuario_id = ? AND revoked_at IS NULL', [user.id]);
  const session = await run(
    `INSERT INTO sesiones (usuario_id, token_hash, ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, hashToken(token), normalizeIp(req), normalizeUserAgent(req), expiresInMinutes(config.sessionMinutes)]
  );
  res.cookie('pv_session', token, cookieOptions(config.sessionMinutes * 60 * 1000));
  await run('UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP, failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
  await audit({ ...req, user }, 'login', 'usuarios', user.id, { sessionId: session.lastInsertRowid });
  res.json({ id: user.id, nombre: user.nombre, email: user.email, role: user.role, department_id: user.department_id, sessionToken: token });
});

authRouter.post('/logout', authRequired, async (req, res) => {
  if (req.session?.id) await run('UPDATE sesiones SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?', [req.session.id]);
  await audit(req, 'logout', 'usuarios', req.user.id);
  res.clearCookie('pv_session', cookieOptions(0));
  res.json({ ok: true });
});

authRouter.get('/me', authRequired, (req, res) => res.json(req.user));

authRouter.get('/users', authRequired, requireRole('admin'), async (_req, res) => {
  res.json(await getUsers());
});

authRouter.post('/users', authRequired, requireRole('admin'), async (req, res) => {
  const data = userSchema.parse(req.body);
  const role = await get('SELECT id FROM roles WHERE nombre = ?', [data.role]);
  if (!role) return res.status(400).json({ message: 'Rol no válido' });
  const hash = await bcrypt.hash(data.password, 12);
  const result = await run(
    'INSERT INTO usuarios (nombre, email, password_hash, role_id, department_id, activo) VALUES (?, ?, ?, ?, ?, ?)',
    [data.nombre, data.email, hash, role.id, data.role === 'taller' ? null : data.department_id, Boolean(data.activo)]
  );
  await audit(req, 'crear_usuario', 'usuarios', result.lastInsertRowid, { email: data.email, role: data.role });
  res.status(201).json((await getUsers()).find((u) => Number(u.id) === Number(result.lastInsertRowid)));
});

authRouter.patch('/users/:id/status', authRequired, requireRole('admin'), async (req, res) => {
  const activo = Number(req.body.activo) === 1;
  if (Number(req.params.id) === Number(req.user.id) && !activo) {
    return res.status(400).json({ message: 'No puedes desactivar tu propia cuenta' });
  }
  await run('UPDATE usuarios SET activo = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [activo, req.params.id]);
  await audit(req, 'cambiar_estado_usuario', 'usuarios', req.params.id, { activo });
  res.json((await getUsers()).find((u) => Number(u.id) === Number(req.params.id)));
});

authRouter.patch('/users/:id/password', authRequired, requireRole('admin'), async (req, res) => {
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres' });

  const user = await get('SELECT id FROM usuarios WHERE id = ?', [req.params.id]);
  if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

  const hash = await bcrypt.hash(password, 12);
  await run('UPDATE usuarios SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [hash, req.params.id]);
  await run('UPDATE sesiones SET revoked_at = CURRENT_TIMESTAMP WHERE usuario_id = ? AND id != ?', [req.params.id, req.session?.id || 0]);
  await audit(req, 'cambiar_contrasena_usuario', 'usuarios', req.params.id);
  res.json({ ok: true });
});

authRouter.post('/password/request-reset', sensitiveLimiter, async (req, res) => {
  const email = String(req.body.email || '').slice(0, 160);
  const user = await get('SELECT id FROM usuarios WHERE lower(email) = lower(?) AND activo = true', [email]);
  let devToken;
  if (user) {
    const token = randomToken();
    devToken = token;
    await run(
      'INSERT INTO password_reset_tokens (usuario_id, token_hash, expires_at) VALUES (?, ?, ?)',
      [user.id, hashToken(token), expiresInMinutes(config.passwordResetMinutes)]
    );
    await audit({ ...req, user: { id: user.id } }, 'solicitar_reset_password', 'usuarios', user.id);
  }
  res.json({
    ok: true,
    message: 'Si el correo existe, se generará un enlace temporal de recuperación.',
    resetToken: process.env.NODE_ENV === 'production' ? undefined : devToken
  });
});

authRouter.post('/password/reset', sensitiveLimiter, async (req, res) => {
  const tokenHash = hashToken(String(req.body.token || ''));
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres' });
  const reset = await get(
    `SELECT * FROM password_reset_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [tokenHash]
  );
  if (!reset) return res.status(400).json({ message: 'Token inválido o expirado' });
  const hash = await bcrypt.hash(password, 12);
  await run('UPDATE usuarios SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [hash, reset.usuario_id]);
  await run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [reset.id]);
  await run('UPDATE sesiones SET revoked_at = CURRENT_TIMESTAMP WHERE usuario_id = ?', [reset.usuario_id]);
  await audit({ ...req, user: { id: reset.usuario_id } }, 'reset_password', 'usuarios', reset.usuario_id);
  res.json({ ok: true });
});

authRouter.post('/email/request-verification', authRequired, sensitiveLimiter, async (req, res) => {
  const token = randomToken();
  await run(
    'INSERT INTO email_verification_tokens (usuario_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [req.user.id, hashToken(token), expiresInMinutes(60)]
  );
  await audit(req, 'solicitar_verificacion_email', 'usuarios', req.user.id);
  res.json({ ok: true, verificationToken: process.env.NODE_ENV === 'production' ? undefined : token });
});

authRouter.post('/email/verify', sensitiveLimiter, async (req, res) => {
  const verification = await get(
    `SELECT * FROM email_verification_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [hashToken(String(req.body.token || ''))]
  );
  if (!verification) return res.status(400).json({ message: 'Token inválido o expirado' });
  await run('UPDATE usuarios SET email_verified = true WHERE id = ?', [verification.usuario_id]);
  await run('UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [verification.id]);
  await audit({ ...req, user: { id: verification.usuario_id } }, 'verificar_email', 'usuarios', verification.usuario_id);
  res.json({ ok: true });
});

authRouter.post('/mfa/setup', authRequired, requireRole('admin'), async (req, res) => {
  const secret = randomToken(20);
  await run('UPDATE usuarios SET mfa_secret = ?, mfa_enabled = false WHERE id = ?', [secret, req.user.id]);
  await audit(req, 'mfa_setup', 'usuarios', req.user.id);
  res.json({ secret });
});

authRouter.post('/mfa/enable', authRequired, requireRole('admin'), async (req, res) => {
  const user = await get('SELECT mfa_secret FROM usuarios WHERE id = ?', [req.user.id]);
  if (!verifyTotp(user?.mfa_secret, req.body.code)) return res.status(400).json({ message: 'Código MFA inválido' });
  await run('UPDATE usuarios SET mfa_enabled = true WHERE id = ?', [req.user.id]);
  await audit(req, 'mfa_enable', 'usuarios', req.user.id);
  res.json({ ok: true });
});

async function getUsers() {
  return all(
    `SELECT u.id, u.nombre, u.email, u.department_id, d.nombre AS departamento, r.nombre AS role,
            u.activo, u.ultimo_acceso, u.failed_login_attempts, u.locked_until, u.created_at
     FROM usuarios u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departamentos d ON d.id = u.department_id
     ORDER BY u.activo DESC, u.nombre`
  );
}
