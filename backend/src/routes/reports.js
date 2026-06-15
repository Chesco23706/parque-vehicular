import { Router } from 'express';
import { all, get, run, transaction } from '../db.js';
import { authRequired, canAccessDepartment, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { departmentScope, whereClause } from '../sql.js';
import { reportSchema, seguimientoSchema } from '../validators.js';
import { audit } from '../audit.js';
import { createSignedUpload, downloadFile as downloadStorageFile, removeFiles, uploadFile } from '../storage.js';

export const reportsRouter = Router();
const REPORTS_BUCKET = 'evidencias-reportes';
const vehicleStatusByFlow = {
  'Reparacion terminada': 'Disponible',
  'Vehiculo entregado': 'Disponible',
  'Caso cerrado': 'Disponible'
};
const completedReportFlows = ['Reparacion terminada', 'Vehiculo entregado', 'Caso cerrado'];
const shopReportFlows = ['Taller asignado', 'En diagnostico', 'Reparacion en proceso'];

function safeDownloadName(fileName) {
  return String(fileName || 'archivo').replace(/[\r\n"\\]/g, '').trim() || 'archivo';
}

function reportAccess(req, reporte) {
  return req.user.role === 'admin' || req.user.role === 'taller' || canAccessDepartment(req, reporte.department_id);
}

async function applyVehicleStatusFromReportFlow(tx, reporte, flowStatus) {
  const nextVehicleStatus = vehicleStatusByFlow[flowStatus];
  if (!nextVehicleStatus) return;

  if (nextVehicleStatus === 'Disponible') {
    const blockingReports = await tx.get(
      `SELECT COUNT(*) AS total
       FROM reportes_fallas
       WHERE vehiculo_id = ?
         AND id != ?
         AND flujo_estatus NOT IN ('Reparacion terminada', 'Vehiculo entregado', 'Caso cerrado')`,
      [reporte.vehiculo_id, reporte.id]
    );
    if (Number(blockingReports?.total || 0) > 0) return;
  }

  await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextVehicleStatus, reporte.vehiculo_id]);
}

async function releaseVehicleIfNoBlockingReports(tx, vehicleId, ignoredReportId) {
  const blockingReports = await tx.get(
    `SELECT COUNT(*) AS total
     FROM reportes_fallas
     WHERE vehiculo_id = ?
       AND id != ?
       AND flujo_estatus NOT IN ('Reparacion terminada', 'Vehiculo entregado', 'Caso cerrado')`,
    [vehicleId, ignoredReportId]
  );
  const blockingRepairs = await tx.get(
    `SELECT COUNT(*) AS total
     FROM reparaciones
     WHERE vehiculo_id = ?
       AND estatus NOT IN ('Reparacion terminada', 'Entregado')`,
    [vehicleId]
  );
  if (!Number(blockingReports?.total || 0) && !Number(blockingRepairs?.total || 0)) {
    await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['Disponible', vehicleId]);
  }
}

async function applyVehicleStatusForReport(tx, report) {
  if (completedReportFlows.includes(report.flujo_estatus)) {
    return;
  }

  const nextVehicleStatus = shopReportFlows.includes(report.flujo_estatus) ? 'En taller' : 'Con falla reportada';
  await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextVehicleStatus, report.vehiculo_id]);
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
    evidencias: await all(
      `SELECT e.id, e.file_name, e.mime_type, e.size_bytes, e.created_at,
              CASE WHEN a.cotizacion_evidencia_id = e.id THEN true ELSE false END AS es_cotizacion
       FROM evidencias_reportes e
       LEFT JOIN asignaciones_taller a ON a.reporte_id = e.reporte_id AND a.cotizacion_evidencia_id = e.id
       WHERE e.reporte_id = ?
       ORDER BY e.created_at DESC`,
      [req.params.id]
    )
  });
});

reportsRouter.get('/:id/evidencias/:evidenciaId/download', authRequired, async (req, res) => {
  const evidencia = await get(
    `SELECT e.*, r.department_id
     FROM evidencias_reportes e
     JOIN reportes_fallas r ON r.id = e.reporte_id
     WHERE e.id = ? AND e.reporte_id = ?`,
    [req.params.evidenciaId, req.params.id]
  );
  if (!evidencia) return res.status(404).json({ message: 'Evidencia no encontrada' });
  if (!reportAccess(req, evidencia)) return res.status(403).json({ message: 'Permiso insuficiente' });

  const buffer = await downloadStorageFile(evidencia.bucket || REPORTS_BUCKET, evidencia.stored_name);
  if (!buffer) return res.status(404).json({ message: 'Archivo no encontrado en almacenamiento' });

  const fileName = safeDownloadName(evidencia.file_name);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  await audit(req, 'descargar_evidencia_reporte', 'evidencias_reportes', evidencia.id, { reporte_id: evidencia.reporte_id });
  res.type(evidencia.mime_type || 'application/octet-stream').send(buffer);
});

reportsRouter.post('/:id/evidencias/sign', authRequired, async (req, res) => {
  const reporte = await get('SELECT * FROM reportes_fallas WHERE id = ?', [req.params.id]);
  if (!reporte) return res.status(404).json({ message: 'Reporte no encontrado' });
  if (!reportAccess(req, reporte)) return res.status(403).json({ message: 'Permiso insuficiente' });
  const signed = await createSignedUpload(REPORTS_BUCKET, req.body, `reportes/${reporte.id}`);
  res.json(signed);
});

reportsRouter.post('/:id/evidencias/complete', authRequired, async (req, res) => {
  const reporte = await get('SELECT * FROM reportes_fallas WHERE id = ?', [req.params.id]);
  if (!reporte) return res.status(404).json({ message: 'Reporte no encontrado' });
  if (!reportAccess(req, reporte)) return res.status(403).json({ message: 'Permiso insuficiente' });
  const bucket = String(req.body.bucket || '');
  const storedName = String(req.body.storedName || '');
  if (bucket !== REPORTS_BUCKET || !storedName.startsWith(`reportes/${reporte.id}/`)) {
    return res.status(400).json({ message: 'Ruta de evidencia no válida' });
  }
  const result = await run(
    `INSERT INTO evidencias_reportes (reporte_id, uploaded_by, file_name, stored_name, mime_type, size_bytes, bucket)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [reporte.id, req.user.id, req.body.fileName, storedName, req.body.mimeType, req.body.sizeBytes, bucket]
  );
  await audit(req, 'subir_evidencia_reporte', 'evidencias_reportes', result.lastInsertRowid, { reporte_id: reporte.id, fileName: req.body.fileName });
  res.status(201).json({ id: result.lastInsertRowid });
});

reportsRouter.put('/:id', authRequired, requireRole('admin'), async (req, res) => {
  const current = await get('SELECT * FROM reportes_fallas WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ message: 'Reporte no encontrado' });

  const data = reportSchema.parse(req.body);
  const vehicle = await get('SELECT * FROM vehiculos WHERE id = ?', [data.vehiculo_id]);
  if (!vehicle) return res.status(404).json({ message: 'Vehiculo no encontrado' });

  const vehicleChanged = Number(current.vehiculo_id) !== Number(vehicle.id);

  await transaction(async (tx) => {
    await tx.run(
      `UPDATE reportes_fallas
       SET vehiculo_id = ?, department_id = ?, tipo_falla = ?, descripcion = ?, urgencia = ?
       WHERE id = ?`,
      [vehicle.id, vehicle.department_id, data.tipo_falla, data.descripcion, data.urgencia, current.id]
    );
    await tx.run('UPDATE reparaciones SET department_id = ? WHERE reporte_id = ?', [vehicle.department_id, current.id]);

    if (vehicleChanged) {
      await tx.run('UPDATE asignaciones_taller SET vehiculo_id = ? WHERE reporte_id = ?', [vehicle.id, current.id]);
      await tx.run('UPDATE reparaciones SET vehiculo_id = ? WHERE reporte_id = ?', [vehicle.id, current.id]);
      await releaseVehicleIfNoBlockingReports(tx, current.vehiculo_id, current.id);
      await applyVehicleStatusForReport(tx, { ...current, vehiculo_id: vehicle.id });
    }
  });

  await audit(req, 'editar_reporte_falla', 'reportes_fallas', current.id, data);
  res.json(await get('SELECT * FROM reportes_fallas WHERE id = ?', [current.id]));
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
    await applyVehicleStatusFromReportFlow(tx, reporte, data.flujo_estatus);
    await tx.run('INSERT INTO seguimiento_reportes (reporte_id, usuario_id, estatus_anterior, estatus_nuevo, comentario, evidencia_id) VALUES (?, ?, ?, ?, ?, ?)', [reporte.id, req.user.id, reporte.flujo_estatus, data.flujo_estatus, data.comentario, evidence]);
    return evidence;
  });

  await audit(req, 'actualizar_seguimiento', 'reportes_fallas', reporte.id, { ...data, evidenciaId });
  res.json(await get('SELECT * FROM reportes_fallas WHERE id = ?', [reporte.id]));
});
