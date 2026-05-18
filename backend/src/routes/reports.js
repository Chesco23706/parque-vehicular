import { Router } from 'express';
import { all, get, transaction } from '../db.js';
import { authRequired, canAccessDepartment, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { departmentScope, whereClause } from '../sql.js';
import { reportSchema, seguimientoSchema } from '../validators.js';
import { audit } from '../audit.js';
import { removeFiles, uploadFile } from '../storage.js';

export const reportsRouter = Router();
const REPORTS_BUCKET = 'evidencias-reportes';

function reportAccess(req, reporte) {
  return req.user.role === 'admin' || req.user.role === 'taller' || canAccessDepartment(req, reporte.department_id);
}

async function saveReportEvidence(tx, reporteId, userId, file) {
  const saved = await uploadFile(REPORTS_BUCKET, file, `reportes/${reporteId}`);
  const evidence = await tx.run(
    `INSERT INTO evidencias_reportes (reporte_id, uploaded_by, file_name, stored_name, mime_type, size_bytes, bucket)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [reporteId, userId, saved.fileName, saved.storedName, saved.mimeType, saved.sizeBytes, saved.bucket]
  );
  return evidence.lastInsertRowid;
}

reportsRouter.get('/', authRequired, async (req, res) => {
  const scope = whereClause(departmentScope(req, 'r.department_id'));
  const rows = await all(
    `SELECT r.*, v.numero_economico, v.tipo AS vehiculo_tipo, d.nombre AS departamento, u.nombre AS usuario,
            a.id AS asignacion_id, a.cotizacion_total, a.cotizacion_registrada_at, t.nombre AS taller_asignado
     FROM reportes_fallas r
     JOIN vehiculos v ON v.id = r.vehiculo_id
     JOIN departamentos d ON d.id = r.department_id
     JOIN usuarios u ON u.id = r.usuario_id
     LEFT JOIN asignaciones_taller a ON a.reporte_id = r.id
     LEFT JOIN talleres t ON t.id = a.taller_id
     ${scope.sql}
     ORDER BY r.created_at DESC`,
    scope.params
  );
  res.json(rows);
});

reportsRouter.post('/', authRequired, upload.array('evidencias', 5), async (req, res) => {
  const data = reportSchema.parse(req.body);
  const vehicle = await get('SELECT * FROM vehiculos WHERE id = ?', [data.vehiculo_id]);
  if (!vehicle) return res.status(404).json({ message: 'Vehículo no encontrado' });
  if (!canAccessDepartment(req, vehicle.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });

  const created = await transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO reportes_fallas (vehiculo_id, department_id, usuario_id, tipo_falla, descripcion, urgencia)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [vehicle.id, vehicle.department_id, req.user.id, data.tipo_falla, data.descripcion, data.urgencia]
    );
    const reportId = result.lastInsertRowid;
    await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['Con falla reportada', vehicle.id]);
    await tx.run('INSERT INTO historial_estatus (vehiculo_id, usuario_id, estatus_anterior, estatus_nuevo, comentario) VALUES (?, ?, ?, ?, ?)', [vehicle.id, req.user.id, vehicle.estatus, 'Con falla reportada', 'Reporte de falla creado']);
    await tx.run('INSERT INTO seguimiento_reportes (reporte_id, usuario_id, estatus_anterior, estatus_nuevo, comentario) VALUES (?, ?, ?, ?, ?)', [reportId, req.user.id, null, 'Reporte recibido', 'Reporte inicial']);
    for (const file of req.files || []) {
      await saveReportEvidence(tx, reportId, req.user.id, file);
    }
    return reportId;
  });

  await audit(req, 'crear_reporte_falla', 'reportes_fallas', created, data);
  res.status(201).json(await get('SELECT * FROM reportes_fallas WHERE id = ?', [created]));
});

reportsRouter.get('/:id', authRequired, async (req, res) => {
  const reporte = await get('SELECT * FROM reportes_fallas WHERE id = ?', [req.params.id]);
  if (!reporte) return res.status(404).json({ message: 'Reporte no encontrado' });
  if (!reportAccess(req, reporte)) return res.status(403).json({ message: 'Permiso insuficiente' });
  res.json({
    reporte,
    seguimiento: await all(`SELECT s.*, u.nombre AS usuario FROM seguimiento_reportes s JOIN usuarios u ON u.id = s.usuario_id WHERE reporte_id = ? ORDER BY created_at`, [req.params.id]),
    evidencias: await all('SELECT id, file_name, mime_type, size_bytes, created_at FROM evidencias_reportes WHERE reporte_id = ? ORDER BY created_at DESC', [req.params.id])
  });
});

reportsRouter.delete('/:id', authRequired, requireRole('admin'), async (req, res) => {
  const reporte = await get('SELECT * FROM reportes_fallas WHERE id = ?', [req.params.id]);
  if (!reporte) return res.status(404).json({ message: 'Reporte no encontrado' });
  const files = await all('SELECT bucket, stored_name FROM evidencias_reportes WHERE reporte_id = ?', [reporte.id]);

  await transaction(async (tx) => {
    await tx.run('DELETE FROM asignaciones_taller WHERE reporte_id = ?', [reporte.id]);
    await tx.run('DELETE FROM reparaciones WHERE reporte_id = ?', [reporte.id]);
    await tx.run('DELETE FROM seguimiento_reportes WHERE reporte_id = ?', [reporte.id]);
    await tx.run('DELETE FROM evidencias_reportes WHERE reporte_id = ?', [reporte.id]);
    await tx.run('DELETE FROM reportes_fallas WHERE id = ?', [reporte.id]);
    const openReports = await tx.get(
      `SELECT COUNT(*) AS total FROM reportes_fallas
       WHERE vehiculo_id = ? AND flujo_estatus != 'Caso cerrado'`,
      [reporte.vehiculo_id]
    );
    if (!Number(openReports?.total || 0)) {
      await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['Disponible', reporte.vehiculo_id]);
    }
  });

  const grouped = files.reduce((acc, file) => {
    const bucket = file.bucket || REPORTS_BUCKET;
    acc[bucket] = [...(acc[bucket] || []), file.stored_name];
    return acc;
  }, {});
  for (const [bucket, paths] of Object.entries(grouped)) await removeFiles(bucket, paths);
  await audit(req, 'eliminar_reporte_falla', 'reportes_fallas', reporte.id, { vehiculo_id: reporte.vehiculo_id });
  res.json({ ok: true });
});

reportsRouter.post('/:id/seguimiento', authRequired, requireRole('admin', 'taller'), upload.single('evidencia'), async (req, res) => {
  const reporte = await get('SELECT * FROM reportes_fallas WHERE id = ?', [req.params.id]);
  if (!reporte) return res.status(404).json({ message: 'Reporte no encontrado' });
  const data = seguimientoSchema.parse(req.body);
  const repairStatus = {
    'En diagnostico': 'En diagnostico',
    'Reparacion en proceso': 'En reparacion',
    'Reparacion terminada': 'Reparacion terminada',
    'Vehiculo entregado': 'Entregado',
    'Caso cerrado': 'Entregado'
  }[data.flujo_estatus];

  const evidenciaId = await transaction(async (tx) => {
    let evidence = null;
    if (req.file) evidence = await saveReportEvidence(tx, reporte.id, req.user.id, req.file);
    await tx.run('UPDATE reportes_fallas SET flujo_estatus = ?, closed_at = CASE WHEN ? = ? THEN CURRENT_TIMESTAMP ELSE closed_at END WHERE id = ?', [data.flujo_estatus, data.flujo_estatus, 'Caso cerrado', reporte.id]);
    if (repairStatus) {
      await tx.run('UPDATE reparaciones SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE reporte_id = ?', [repairStatus, reporte.id]);
    }
    if (['Reparacion terminada', 'Vehiculo entregado', 'Caso cerrado'].includes(data.flujo_estatus)) {
      await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['Reparado', reporte.vehiculo_id]);
    }
    await tx.run('INSERT INTO seguimiento_reportes (reporte_id, usuario_id, estatus_anterior, estatus_nuevo, comentario, evidencia_id) VALUES (?, ?, ?, ?, ?, ?)', [reporte.id, req.user.id, reporte.flujo_estatus, data.flujo_estatus, data.comentario, evidence]);
    return evidence;
  });

  await audit(req, 'actualizar_seguimiento', 'reportes_fallas', reporte.id, { ...data, evidenciaId });
  res.json(await get('SELECT * FROM reportes_fallas WHERE id = ?', [reporte.id]));
});
