import { Router } from 'express';
import { all } from '../db.js';
import { authRequired } from '../middleware/auth.js';

export const metaRouter = Router();

metaRouter.get('/departamentos', authRequired, async (req, res) => {
  if (req.user.role === 'admin') return res.json(await all('SELECT * FROM departamentos WHERE activo = true ORDER BY nombre'));
  return res.json(await all('SELECT * FROM departamentos WHERE id = ?', [req.user.department_id]));
});

metaRouter.get('/catalogos', authRequired, (_req, res) => {
  res.json({
    estatusVehiculo: ['Disponible', 'En uso', 'Con falla reportada', 'En revision', 'En taller', 'Reparado', 'Fuera de servicio'],
    tiposFalla: ['Mecanica', 'Electrica', 'Llantas', 'Frenos', 'Motor', 'Carroceria', 'Documentacion', 'Otro'],
    urgencias: ['Baja', 'Media', 'Alta', 'Critica'],
    flujo: ['Reporte recibido', 'En revision por Parque Vehicular', 'Taller asignado', 'En diagnostico', 'Reparacion en proceso', 'Reparacion terminada', 'Vehiculo entregado', 'Caso cerrado']
  });
});

