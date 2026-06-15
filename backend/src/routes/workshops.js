import { Router } from 'express';
import { all, get, run, transaction } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { asignacionSchema, tallerSchema } from '../validators.js';
import { audit } from '../audit.js';
import { budgetSummaryForDate } from '../budget.js';
import { uploadFile } from '../storage.js';

export const workshopsRouter = Router();
const QUOTES_BUCKET = 'cotizaciones';

function presupuestoDelReporte(reporte) {
  return budgetSummaryForDate(reporte.budget_month || reporte.created_at);
}

async function resolveWorkshop(tx, data) {
  if (data.taller_id) {
    const taller = await tx.get('SELECT * FROM talleres WHERE id = ? AND activo = true', [data.taller_id]);
    if (taller) return taller;
  }
  const name = String(data.taller_nombre || '').trim();
  if (!name) return null;
  const existing = await tx.get('SELECT * FROM talleres WHERE lower(nombre) = lower(?) AND activo = true', [name]);
  if (existing) return existing;
  const result = await tx.run(
    'INSERT INTO talleres (nombre, contacto, telefono, direccion, tipo_servicio) VALUES (?, ?, ?, ?, ?)',
    [name, '', '', '', 'Servicio registrado desde cotizacion']
  );
  return tx.get('SELECT * FROM talleres WHERE id = ?', [result.lastInsertRowid]);
}

workshopsRouter.get('/', authRequired, requireRole('admin', 'taller'), async (_req, res) => {
  res.json(await all('SELECT * FROM talleres WHERE activo = true ORDER BY nombre'));
});

workshopsRouter.post('/', authRequired, requireRole('admin'), async (req, res) => {
  const data = tallerSchema.parse(req.body);
  const result = await run('INSERT INTO talleres (nombre, contacto, telefono, direccion, tipo_servicio) VALUES (?, ?, ?, ?, ?)', [data.nombre, data.contacto, data.telefono, data.direccion, data.tipo_servicio]);
  await audit(req, 'crear_taller', 'talleres', result.lastInsertRowid, data);
  res.status(201).json(await get('SELECT * FROM talleres WHERE id = ?', [result.lastInsertRowid]));
});

workshopsRouter.get('/asignaciones', authRequired, requireRole('admin', 'taller'), async (_req, res) => {
  res.json(await all(
    `SELECT a.*, t.nombre AS taller, v.numero_economico, r.urgencia, r.flujo_estatus
     FROM asignaciones_taller a
     LEFT JOIN talleres t ON t.id = a.taller_id
     JOIN vehiculos v ON v.id = a.vehiculo_id
     JOIN reportes_fallas r ON r.id = a.reporte_id
     ORDER BY a.created_at DESC`
  ));
});

workshopsRouter.post('/asignaciones', authRequired, requireRole('admin'), async (req, res) => {
  const data = asignacionSchema.parse(req.body);
  const reporte = await get("SELECT *, to_char(created_at, 'YYYY-MM') AS budget_month FROM reportes_fallas WHERE id = ?", [data.reporte_id]);
  if (!reporte) return res.status(404).json({ message: 'Reporte no encontrado' });
  const budget = await presupuestoDelReporte(reporte);
  if (Number(data.costo_estimado || 0) > budget.disponible) {
    return res.status(400).json({ message: `Presupuesto insuficiente para asignar este reporte en ${budget.month}` });
  }

  const id = await transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO asignaciones_taller (reporte_id, taller_id, vehiculo_id, fecha_ingreso, fecha_estimada_entrega, costo_estimado, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reporte.id, data.taller_id, reporte.vehiculo_id, data.fecha_ingreso, data.fecha_estimada_entrega, data.costo_estimado, data.observaciones]
    );
    await tx.run('UPDATE reportes_fallas SET flujo_estatus = ? WHERE id = ?', ['Taller asignado', reporte.id]);
    await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['En taller', reporte.vehiculo_id]);
    await tx.run('INSERT INTO seguimiento_reportes (reporte_id, usuario_id, estatus_anterior, estatus_nuevo, comentario) VALUES (?, ?, ?, ?, ?)', [reporte.id, req.user.id, reporte.flujo_estatus, 'Taller asignado', 'Asignacion de taller registrada']);
    const taller = await tx.get('SELECT * FROM talleres WHERE id = ?', [data.taller_id]);
    const vehicle = await tx.get('SELECT * FROM vehiculos WHERE id = ?', [reporte.vehiculo_id]);
    const existingRepair = await tx.get('SELECT id FROM reparaciones WHERE reporte_id = ?', [reporte.id]);
    if (!existingRepair) {
      await tx.run(
        `INSERT INTO reparaciones
         (reporte_id, vehiculo_id, department_id, usuario_id, taller_nombre, taller_direccion, descripcion, fecha_ingreso,
          fecha_estimada_entrega, estatus, cotizacion_total, cotizacion_registrada_at, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE NULL END, ?)`,
        [
          reporte.id,
          reporte.vehiculo_id,
          reporte.department_id,
          req.user.id,
          taller?.nombre || 'Taller asignado',
          taller?.direccion || '',
          reporte.descripcion,
          data.fecha_ingreso,
          data.fecha_estimada_entrega,
          'En diagnostico',
          data.costo_estimado,
          data.costo_estimado,
          data.observaciones
        ]
      );
      await tx.run('INSERT INTO historial_estatus (vehiculo_id, usuario_id, estatus_anterior, estatus_nuevo, comentario) VALUES (?, ?, ?, ?, ?)', [reporte.vehiculo_id, req.user.id, vehicle?.estatus || 'Con falla reportada', 'En taller', `Unidad enviada a ${taller?.nombre || 'taller asignado'}`]);
    }
    return result.lastInsertRowid;
  });

  await audit(req, 'asignar_taller', 'asignaciones_taller', id, data);
  res.status(201).json(await get('SELECT * FROM asignaciones_taller WHERE id = ?', [id]));
});

workshopsRouter.post('/asignaciones-cotizacion', authRequired, requireRole('admin'), upload.single('cotizacion'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Debes subir el archivo de cotizacion' });
  const data = asignacionSchema.parse(req.body);
  if (!data.cotizacion_total || data.cotizacion_total <= 0) return res.status(400).json({ message: 'Captura el total de la cotizacion' });

  const reporte = await get("SELECT *, to_char(created_at, 'YYYY-MM') AS budget_month FROM reportes_fallas WHERE id = ?", [data.reporte_id]);
  if (!reporte) return res.status(404).json({ message: 'Reporte no encontrado' });
  const existing = await get('SELECT id FROM asignaciones_taller WHERE reporte_id = ?', [data.reporte_id]);
  if (existing) return res.status(409).json({ message: 'Este reporte ya tiene taller asignado' });
  const budget = await presupuestoDelReporte(reporte);
  if (data.cotizacion_total > budget.disponible) {
    return res.status(400).json({ message: `Presupuesto insuficiente para registrar esta cotizacion en ${budget.month}` });
  }
  const quote = await uploadFile(QUOTES_BUCKET, req.file, `reportes/${reporte.id}`);

  const id = await transaction(async (tx) => {
    const taller = await resolveWorkshop(tx, data);
    const evidence = await tx.run(
      `INSERT INTO evidencias_reportes (reporte_id, uploaded_by, file_name, stored_name, mime_type, size_bytes, bucket)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reporte.id, req.user.id, quote.fileName, quote.storedName, quote.mimeType, quote.sizeBytes, quote.bucket]
    );
    const result = await tx.run(
      `INSERT INTO asignaciones_taller
       (reporte_id, taller_id, vehiculo_id, fecha_ingreso, fecha_estimada_entrega, costo_estimado, cotizacion_evidencia_id, cotizacion_total, cotizacion_registrada_at, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [reporte.id, taller?.id || null, reporte.vehiculo_id, data.fecha_ingreso, data.fecha_estimada_entrega, data.cotizacion_total, evidence.lastInsertRowid, data.cotizacion_total, data.observaciones]
    );
    await tx.run('UPDATE reportes_fallas SET flujo_estatus = ? WHERE id = ?', ['Taller asignado', reporte.id]);
    await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['En taller', reporte.vehiculo_id]);
    const atencion = taller?.nombre || 'sin taller asignado';
    await tx.run(
      'INSERT INTO seguimiento_reportes (reporte_id, usuario_id, estatus_anterior, estatus_nuevo, comentario, evidencia_id) VALUES (?, ?, ?, ?, ?, ?)',
      [reporte.id, req.user.id, reporte.flujo_estatus, 'Taller asignado', `Cotizacion registrada por ${data.cotizacion_total} pesos (${atencion}).`, evidence.lastInsertRowid]
    );
    const vehicle = await tx.get('SELECT * FROM vehiculos WHERE id = ?', [reporte.vehiculo_id]);
    const existingRepair = await tx.get('SELECT id FROM reparaciones WHERE reporte_id = ?', [reporte.id]);
    if (!existingRepair) {
      await tx.run(
        `INSERT INTO reparaciones
         (reporte_id, vehiculo_id, department_id, usuario_id, taller_nombre, taller_direccion, descripcion, fecha_ingreso,
          fecha_estimada_entrega, estatus, cotizacion_total, cotizacion_registrada_at, cotizacion_evidencia_id, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
        [
          reporte.id,
          reporte.vehiculo_id,
          reporte.department_id,
          req.user.id,
          taller?.nombre || 'Sin taller asignado',
          taller?.direccion || '',
          reporte.descripcion,
          data.fecha_ingreso,
          data.fecha_estimada_entrega,
          'En diagnostico',
          data.cotizacion_total,
          evidence.lastInsertRowid,
          data.observaciones
        ]
      );
      await tx.run('INSERT INTO historial_estatus (vehiculo_id, usuario_id, estatus_anterior, estatus_nuevo, comentario) VALUES (?, ?, ?, ?, ?)', [reporte.vehiculo_id, req.user.id, vehicle?.estatus || 'Con falla reportada', 'En taller', taller ? `Unidad enviada a ${taller.nombre}` : 'Unidad marcada en atencion sin taller asignado']);
    }
    return result.lastInsertRowid;
  });

  await audit(req, 'asignar_taller_con_cotizacion', 'asignaciones_taller', id, { ...data, file: req.file.originalname });
  res.status(201).json(await get('SELECT * FROM asignaciones_taller WHERE id = ?', [id]));
});
