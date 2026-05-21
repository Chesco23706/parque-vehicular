import { run } from './db.js';
import { sendSecurityAlert } from './security.js';

const alertActions = new Map([
  ['login_bloqueado', 'high'],
  ['captcha_fallido', 'high'],
  ['captcha_requerido', 'medium'],
  ['mfa_fallido', 'high'],
  ['mfa_obligatorio_sin_configurar', 'critical'],
  ['sesion_sospechosa', 'high'],
  ['sesion_ip_cambiada', 'medium'],
  ['sesiones_sospechosas_recurrentes', 'critical'],
  ['error_servidor', 'critical'],
  ['backup_fallido', 'critical'],
  ['backup_generado', 'medium']
]);

export async function audit(req, accion, entidad = null, entidadId = null, detalle = null) {
  await run(
    `INSERT INTO bitacora_actividad (usuario_id, accion, entidad, entidad_id, ip, detalle)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user?.id || null, accion, entidad, entidadId, req.ip || null, detalle ? JSON.stringify(detalle) : null]
  );

  if (alertActions.has(accion)) {
    await sendSecurityAlert(accion, {
      userId: req.user?.id || null,
      entidad,
      entidadId,
      ip: req.ip || null,
      detalle
    }, alertActions.get(accion));
  }
}
