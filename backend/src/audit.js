import { run } from './db.js';

export async function audit(req, accion, entidad = null, entidadId = null, detalle = null) {
  await run(
    `INSERT INTO bitacora_actividad (usuario_id, accion, entidad, entidad_id, ip, detalle)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user?.id || null, accion, entidad, entidadId, req.ip || null, detalle ? JSON.stringify(detalle) : null]
  );
}

