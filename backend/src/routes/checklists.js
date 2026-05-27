import { Router } from 'express';
import { all, get, run } from '../db.js';
import { authRequired, canAccessDepartment } from '../middleware/auth.js';
import { andClause, departmentScope, whereClause } from '../sql.js';
import { checklistSchema } from '../validators.js';
import { audit } from '../audit.js';
import { todayLocal } from '../date.js';
import { upload } from '../middleware/upload.js';
import { createSignedUpload, uploadFile } from '../storage.js';

export const checklistsRouter = Router();
const CHECKLIST_BUCKET = 'evidencias-checklist';

checklistsRouter.get('/', authRequired, async (req, res) => {
  const scope = whereClause(departmentScope(req, 'c.department_id'));
  res.json(await all(
    `SELECT c.*, v.numero_economico, d.nombre AS departamento,
            (SELECT COUNT(*) FROM evidencias_checklist e WHERE e.checklist_id = c.id) AS evidencias_count
     FROM checklist_diario c
     JOIN vehiculos v ON v.id = c.vehiculo_id
     JOIN departamentos d ON d.id = c.department_id
     ${scope.sql}
     ORDER BY c.fecha DESC, c.created_at DESC`,
    scope.params
  ));
});

checklistsRouter.post('/', authRequired, upload.array('evidencias', 5), async (req, res) => {
  const data = checklistSchema.parse(req.body);
  const vehicle = await get('SELECT * FROM vehiculos WHERE id = ?', [data.vehiculo_id]);
  if (!vehicle) return res.status(404).json({ message: 'Vehículo no encontrado' });
  if (!canAccessDepartment(req, vehicle.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });

  const existing = await get('SELECT id FROM checklist_diario WHERE vehiculo_id = ? AND fecha = ?', [vehicle.id, data.fecha]);
  let checklistId = existing?.id;

  if (existing) {
    await run(
      `UPDATE checklist_diario
       SET usuario_id=?, kilometraje_actual=?, nivel_combustible=?, nivel_aceite=?, anticongelante=?, liquido_frenos=?, llantas=?, luces=?, frenos=?, motor=?,
           carroceria=?, documentos_vigentes=?, limpieza=?, observaciones=?, responsable=?
       WHERE id=?`,
      [req.user.id, data.kilometraje_actual, data.nivel_combustible, data.nivel_aceite, data.anticongelante, data.liquido_frenos, data.llantas, data.luces, data.frenos, data.motor, data.carroceria, data.documentos_vigentes, data.limpieza, data.observaciones, data.responsable, checklistId]
    );
  } else {
    const result = await run(
      `INSERT INTO checklist_diario
       (vehiculo_id, department_id, usuario_id, fecha, kilometraje_actual, nivel_combustible, nivel_aceite, anticongelante, liquido_frenos, llantas, luces, frenos, motor, carroceria, documentos_vigentes, limpieza, observaciones, responsable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vehicle.id, vehicle.department_id, req.user.id, data.fecha, data.kilometraje_actual, data.nivel_combustible, data.nivel_aceite, data.anticongelante, data.liquido_frenos, data.llantas, data.luces, data.frenos, data.motor, data.carroceria, data.documentos_vigentes, data.limpieza, data.observaciones, data.responsable]
    );
    checklistId = result.lastInsertRowid;
  }
  for (const file of req.files || []) {
    const saved = await uploadFile(CHECKLIST_BUCKET, file, `checklists/${checklistId}`);
    await run(
      `INSERT INTO evidencias_checklist (checklist_id, uploaded_by, file_name, stored_name, mime_type, size_bytes, bucket)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [checklistId, req.user.id, saved.fileName, saved.storedName, saved.mimeType, saved.sizeBytes, saved.bucket]
    );
  }
  await run('UPDATE vehiculos SET kilometraje = GREATEST(kilometraje, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [data.kilometraje_actual, vehicle.id]);
  await audit(req, existing ? 'actualizar_checklist' : 'crear_checklist', 'checklist_diario', checklistId, data);
  res.status(existing ? 200 : 201).json(await get('SELECT * FROM checklist_diario WHERE id = ?', [checklistId]));
});

checklistsRouter.post('/:id/evidencias/sign', authRequired, async (req, res) => {
  const checklist = await get('SELECT * FROM checklist_diario WHERE id = ?', [req.params.id]);
  if (!checklist) return res.status(404).json({ message: 'Checklist no encontrado' });
  if (!canAccessDepartment(req, checklist.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });
  const signed = await createSignedUpload(CHECKLIST_BUCKET, req.body, `checklists/${checklist.id}`);
  res.json(signed);
});

checklistsRouter.post('/:id/evidencias/complete', authRequired, async (req, res) => {
  const checklist = await get('SELECT * FROM checklist_diario WHERE id = ?', [req.params.id]);
  if (!checklist) return res.status(404).json({ message: 'Checklist no encontrado' });
  if (!canAccessDepartment(req, checklist.department_id)) return res.status(403).json({ message: 'Permiso insuficiente' });
  const bucket = String(req.body.bucket || '');
  const storedName = String(req.body.storedName || '');
  if (bucket !== CHECKLIST_BUCKET || !storedName.startsWith(`checklists/${checklist.id}/`)) {
    return res.status(400).json({ message: 'Ruta de evidencia no válida' });
  }
  const result = await run(
    `INSERT INTO evidencias_checklist (checklist_id, uploaded_by, file_name, stored_name, mime_type, size_bytes, bucket)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [checklist.id, req.user.id, req.body.fileName, storedName, req.body.mimeType, req.body.sizeBytes, bucket]
  );
  await audit(req, 'subir_evidencia_checklist', 'evidencias_checklist', result.lastInsertRowid, { checklist_id: checklist.id, fileName: req.body.fileName });
  res.status(201).json({ id: result.lastInsertRowid });
});

checklistsRouter.get('/alertas', authRequired, async (req, res) => {
  const today = todayLocal();
  const vehicleScope = andClause(departmentScope(req, 'v.department_id'));
  const reportScope = andClause(departmentScope(req, 'r.department_id'));
  res.json({
    faltantes: await all(
      `SELECT v.id, v.numero_economico, d.nombre AS departamento
       FROM vehiculos v JOIN departamentos d ON d.id = v.department_id
       WHERE v.id NOT IN (SELECT vehiculo_id FROM checklist_diario WHERE fecha = ?) ${vehicleScope.sql}
       ORDER BY d.nombre, v.numero_economico`,
      [today, ...vehicleScope.params]
    ),
    problemasFrecuentes: await all(
      `SELECT v.id, v.numero_economico, COUNT(*) AS reportes_30_dias
       FROM reportes_fallas r JOIN vehiculos v ON v.id = r.vehiculo_id
       WHERE r.created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days') ${reportScope.sql}
       GROUP BY v.id HAVING COUNT(*) >= 2 ORDER BY reportes_30_dias DESC`,
      reportScope.params
    )
  });
});

