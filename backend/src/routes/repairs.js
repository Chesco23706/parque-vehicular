import { Router } from 'express';
import { all, get, run, transaction } from '../db.js';
import { audit } from '../audit.js';
import { authRequired, canAccessDepartment, requireRole } from '../middleware/auth.js';
import { departmentScope, whereClause } from '../sql.js';
import { repairSchema } from '../validators.js';
import { upload } from '../middleware/upload.js';
import { budgetMonthFromDate, budgetSummaryForDate } from '../budget.js';
import { downloadFile as downloadStorageFile, uploadFile } from '../storage.js';

export const repairsRouter = Router();
const REPAIRS_BUCKET = 'reparaciones';
const vehicleStatusByRepairStatus = {
  'Reparacion terminada': 'Disponible',
  Entregado: 'Disponible'
};

function safeDownloadName(fileName) {
  return String(fileName || 'cotizacion').replace(/[\r\n"\\]/g, '').trim() || 'cotizacion';
}

async function uploadQuote(file, repairId = 'nueva') {
  return file ? uploadFile(REPAIRS_BUCKET, file, `cotizaciones/${repairId}`) : null;
}

repairsRouter.get('/', authRequired, async (req, res) => {
  const scope = whereClause(departmentScope(req, 'r.department_id'));
  const rows = await all(
    `SELECT r.*, v.numero_economico, v.tipo, v.marca, v.modelo, v.placas, d.nombre AS departamento,
            FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.fecha_ingreso::timestamp)) / 86400)::int AS dias_en_taller
     FROM reparaciones r
     JOIN vehiculos v ON v.id = r.vehiculo_id
     JOIN departamentos d ON d.id = r.department_id
     ${scope.sql}
     ORDER BY r.fecha_ingreso DESC, r.created_at DESC`,
    scope.params
  );
  res.json(rows);
});

repairsRouter.post('/', authRequired, requireRole('admin', 'departamento'), upload.single('cotizacion'), async (req, res) => {
  const data = repairSchema.parse(req.body);
  const vehicle = await get('SELECT * FROM vehiculos WHERE id = ?', [data.vehiculo_id]);
  if (!vehicle) return res.status(404).json({ message: 'Vehiculo no encontrado' });
  if (!canAccessDepartment(req, vehicle.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });

  const budget = await budgetSummaryForDate(data.fecha_ingreso);
  if (data.cotizacion_total > budget.disponible) {
    return res.status(400).json({ message: `Presupuesto insuficiente para registrar esta cotizacion en ${budget.month}` });
  }
  const quote = await uploadQuote(req.file);

  const repairId = await transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO reparaciones
       (vehiculo_id, department_id, usuario_id, taller_nombre, taller_direccion, descripcion, fecha_ingreso, fecha_estimada_entrega,
        estatus, cotizacion_total, cotizacion_registrada_at, cotizacion_file_name, cotizacion_stored_name, cotizacion_mime_type,
        cotizacion_size_bytes, observaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? > 0 THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?, ?, ?, ?)`,
      [
        vehicle.id,
        vehicle.department_id,
        req.user.id,
        data.taller_nombre,
        data.taller_direccion,
        data.descripcion,
        data.fecha_ingreso,
        data.fecha_estimada_entrega,
        data.estatus,
        data.cotizacion_total,
        data.cotizacion_total,
        quote?.fileName || null,
        quote?.storedName || null,
        quote?.mimeType || null,
        quote?.sizeBytes || null,
        data.observaciones
      ]
    );
    await tx.run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['En taller', vehicle.id]);
    await tx.run(
      'INSERT INTO historial_estatus (vehiculo_id, usuario_id, estatus_anterior, estatus_nuevo, comentario) VALUES (?, ?, ?, ?, ?)',
      [vehicle.id, req.user.id, vehicle.estatus, 'En taller', `Reparacion registrada: ${data.descripcion}`]
    );
    return result.lastInsertRowid;
  });

  await audit(req, 'crear_reparacion', 'reparaciones', repairId, data);
  res.status(201).json(await get('SELECT * FROM reparaciones WHERE id = ?', [repairId]));
});

repairsRouter.put('/:id', authRequired, requireRole('admin', 'departamento'), upload.single('cotizacion'), async (req, res) => {
  const current = await get('SELECT * FROM reparaciones WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ message: 'Reparacion no encontrada' });
  if (!canAccessDepartment(req, current.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });
  const data = repairSchema.parse(req.body);

  const currentBudgetMonth = budgetMonthFromDate(current.fecha_ingreso);
  const nextBudgetMonth = budgetMonthFromDate(data.fecha_ingreso);
  const nextTotal = Number(data.cotizacion_total || 0);
  const currentTotal = Number(current.cotizacion_total || 0);
  const requiredBudget = current.reporte_id ? 0 : currentBudgetMonth === nextBudgetMonth ? nextTotal - currentTotal : nextTotal;
  const budget = await budgetSummaryForDate(data.fecha_ingreso);
  if (requiredBudget > budget.disponible) {
    return res.status(400).json({ message: `Presupuesto insuficiente para registrar esta cotizacion en ${budget.month}` });
  }

  const quote = await uploadQuote(req.file, current.id);
  const fileSql = quote ? ', cotizacion_file_name=?, cotizacion_stored_name=?, cotizacion_mime_type=?, cotizacion_size_bytes=?' : '';
  const params = [
    data.taller_nombre,
    data.taller_direccion,
    data.descripcion,
    data.fecha_ingreso,
    data.fecha_estimada_entrega,
    data.estatus,
    data.cotizacion_total,
    data.cotizacion_total,
    data.observaciones
  ];
  if (quote) params.push(quote.fileName, quote.storedName, quote.mimeType, quote.sizeBytes);
  params.push(req.params.id);

  await run(
    `UPDATE reparaciones
     SET taller_nombre=?, taller_direccion=?, descripcion=?, fecha_ingreso=?, fecha_estimada_entrega=?,
         estatus=?, cotizacion_total=?, cotizacion_registrada_at=CASE WHEN ? > 0 THEN COALESCE(cotizacion_registrada_at, CURRENT_TIMESTAMP) ELSE NULL END,
         observaciones=?${fileSql}, updated_at=CURRENT_TIMESTAMP
     WHERE id=?`,
    params
  );

  const nextVehicleStatus = vehicleStatusByRepairStatus[data.estatus];
  if (nextVehicleStatus) {
    await run('UPDATE vehiculos SET estatus = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextVehicleStatus, current.vehiculo_id]);
  }

  await audit(req, 'editar_reparacion', 'reparaciones', req.params.id, data);
  res.json(await get('SELECT * FROM reparaciones WHERE id = ?', [req.params.id]));
});

repairsRouter.get('/:id/cotizacion', authRequired, async (req, res) => {
  const repair = await get('SELECT * FROM reparaciones WHERE id = ?', [req.params.id]);
  if (!repair) return res.status(404).json({ message: 'Reparacion no encontrada' });
  if (!canAccessDepartment(req, repair.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });
  if (!repair.cotizacion_stored_name) return res.status(404).json({ message: 'La reparacion no tiene archivo de cotizacion' });

  const buffer = await downloadStorageFile(REPAIRS_BUCKET, repair.cotizacion_stored_name);
  if (!buffer) return res.status(404).json({ message: 'Archivo no encontrado en almacenamiento' });

  const fileName = safeDownloadName(repair.cotizacion_file_name);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  await audit(req, 'descargar_cotizacion_reparacion', 'reparaciones', repair.id, { vehiculo_id: repair.vehiculo_id });
  res.type(repair.cotizacion_mime_type || 'application/octet-stream').send(buffer);
});
