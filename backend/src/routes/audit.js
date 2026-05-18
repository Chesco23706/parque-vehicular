import { Router } from 'express';
import { all } from '../db.js';
import { authRequired } from '../middleware/auth.js';

export const auditRouter = Router();

auditRouter.get('/', authRequired, async (req, res) => {
  const base = `
    SELECT b.id, b.accion, b.entidad, b.entidad_id, b.ip, b.detalle, b.created_at,
           u.nombre AS usuario, u.email, r.nombre AS rol, d.nombre AS departamento
    FROM bitacora_actividad b
    LEFT JOIN usuarios u ON u.id = b.usuario_id
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN departamentos d ON d.id = u.department_id
  `;

  if (req.user.role === 'admin') {
    return res.json(await all(`${base} ORDER BY b.created_at DESC LIMIT 300`));
  }

  if (req.user.role === 'departamento') {
    return res.json(await all(`${base} WHERE u.department_id = ? ORDER BY b.created_at DESC LIMIT 300`, [req.user.department_id]));
  }

  res.json(await all(`${base} WHERE u.id = ? ORDER BY b.created_at DESC LIMIT 300`, [req.user.id]));
});

