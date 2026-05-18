import { Router } from 'express';
import { all, get, run } from '../db.js';
import { authRequired, canAccessDepartment, requireRole } from '../middleware/auth.js';
import { departmentScope, whereClause } from '../sql.js';
import { vehicleSchema } from '../validators.js';
import { audit } from '../audit.js';

export const vehiclesRouter = Router();

vehiclesRouter.get('/', authRequired, async (req, res) => {
  const scope = whereClause(departmentScope(req, 'v.department_id'));
  res.json(await all(
    `SELECT v.*, d.nombre AS departamento FROM vehiculos v JOIN departamentos d ON d.id = v.department_id ${scope.sql}
     ORDER BY v.numero_economico`,
    scope.params
  ));
});

vehiclesRouter.post('/', authRequired, requireRole('admin', 'departamento'), async (req, res) => {
  const data = vehicleSchema.parse({
    ...req.body,
    department_id: req.user.role === 'admin' ? req.body.department_id : req.user.department_id
  });
  const result = await run(
    `INSERT INTO vehiculos (numero_economico, department_id, tipo, marca, modelo, anio, placas, numero_serie, kilometraje, estatus, observaciones)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.numero_economico, data.department_id, data.tipo, data.marca, data.modelo, data.anio, data.placas, data.numero_serie, data.kilometraje, data.estatus, data.observaciones]
  );
  await audit(req, 'crear_vehiculo', 'vehiculos', result.lastInsertRowid, data);
  res.status(201).json(await get('SELECT * FROM vehiculos WHERE id = ?', [result.lastInsertRowid]));
});

vehiclesRouter.put('/:id', authRequired, requireRole('admin', 'departamento'), async (req, res) => {
  const current = await get('SELECT * FROM vehiculos WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ message: 'Vehículo no encontrado' });
  if (!canAccessDepartment(req, current.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });
  const data = vehicleSchema.parse({
    ...req.body,
    department_id: req.user.role === 'admin' ? req.body.department_id : current.department_id
  });
  await run(
    `UPDATE vehiculos SET numero_economico=?, department_id=?, tipo=?, marca=?, modelo=?, anio=?, placas=?, numero_serie=?,
     kilometraje=?, estatus=?, observaciones=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [data.numero_economico, data.department_id, data.tipo, data.marca, data.modelo, data.anio, data.placas, data.numero_serie, data.kilometraje, data.estatus, data.observaciones, req.params.id]
  );
  if (current.estatus !== data.estatus) {
    await run('INSERT INTO historial_estatus (vehiculo_id, usuario_id, estatus_anterior, estatus_nuevo, comentario) VALUES (?, ?, ?, ?, ?)', [req.params.id, req.user.id, current.estatus, data.estatus, 'Cambio desde edición de vehículo']);
  }
  await audit(req, 'editar_vehiculo', 'vehiculos', req.params.id, data);
  res.json(await get('SELECT * FROM vehiculos WHERE id = ?', [req.params.id]));
});

vehiclesRouter.delete('/:id', authRequired, requireRole('admin', 'departamento'), async (req, res) => {
  const current = await get('SELECT * FROM vehiculos WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ message: 'Vehículo no encontrado' });
  if (!canAccessDepartment(req, current.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });

  const reportes = Number((await get('SELECT COUNT(*) AS total FROM reportes_fallas WHERE vehiculo_id = ?', [req.params.id])).total);
  const checklists = Number((await get('SELECT COUNT(*) AS total FROM checklist_diario WHERE vehiculo_id = ?', [req.params.id])).total);
  const historial = Number((await get('SELECT COUNT(*) AS total FROM historial_estatus WHERE vehiculo_id = ?', [req.params.id])).total);
  if (reportes || checklists || historial) {
    return res.status(409).json({ message: 'No se puede eliminar: el vehículo ya tiene historial, reportes o checklists' });
  }

  await run('DELETE FROM vehiculos WHERE id = ?', [req.params.id]);
  await audit(req, 'eliminar_vehiculo', 'vehiculos', req.params.id);
  res.json({ ok: true });
});

vehiclesRouter.get('/:id/historial', authRequired, async (req, res) => {
  const vehicle = await get(
    `SELECT v.*, d.nombre AS departamento
     FROM vehiculos v
     JOIN departamentos d ON d.id = v.department_id
     WHERE v.id = ?`,
    [req.params.id]
  );
  if (!vehicle) return res.status(404).json({ message: 'Vehículo no encontrado' });
  if (!canAccessDepartment(req, vehicle.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });
  res.json({
    vehiculo: vehicle,
    estatus: await all(
      `SELECT h.*, u.nombre AS usuario
       FROM historial_estatus h
       JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.vehiculo_id = ?
       ORDER BY h.created_at DESC`,
      [req.params.id]
    ),
    reportes: await all(
      `SELECT r.*, u.nombre AS usuario, d.nombre AS departamento
       FROM reportes_fallas r
       JOIN usuarios u ON u.id = r.usuario_id
       JOIN departamentos d ON d.id = r.department_id
       WHERE r.vehiculo_id = ?
       ORDER BY r.created_at DESC`,
      [req.params.id]
    ),
    checklists: await all(
      `SELECT c.*, u.nombre AS usuario, d.nombre AS departamento,
              (SELECT COUNT(*) FROM evidencias_checklist e WHERE e.checklist_id = c.id) AS evidencias_count
       FROM checklist_diario c
       JOIN usuarios u ON u.id = c.usuario_id
       JOIN departamentos d ON d.id = c.department_id
       WHERE c.vehiculo_id = ?
       ORDER BY c.fecha DESC, c.created_at DESC`,
      [req.params.id]
    )
  });
});

