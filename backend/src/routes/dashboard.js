import { Router } from 'express';
import { all, get } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { andClause, departmentScope, whereClause } from '../sql.js';
import { budgetSummary } from '../budget.js';
import { todayLocal } from '../date.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', authRequired, async (req, res) => {
  const department = departmentScope(req, 'department_id');
  const filter = whereClause(department);
  const filterAnd = filter.sql ? `${filter.sql} AND` : 'WHERE';
  const vehicleScope = andClause(departmentScope(req, 'v.department_id'));
  const departmentFilter = whereClause(departmentScope(req, 'd.id'));
  const today = todayLocal();
  const presupuesto = await budgetSummary();

  res.json({
    totalVehiculos: Number((await get(`SELECT COUNT(*) AS total FROM vehiculos ${filter.sql}`, filter.params)).total),
    disponibles: Number((await get(`SELECT COUNT(*) AS total FROM vehiculos ${filterAnd} estatus = 'Disponible'`, filter.params)).total),
    conFallas: Number((await get(`SELECT COUNT(*) AS total FROM vehiculos ${filterAnd} estatus IN ('Con falla reportada', 'Fuera de servicio')`, filter.params)).total),
    enTaller: Number((await get(`SELECT COUNT(*) AS total FROM vehiculos ${filterAnd} estatus = 'En taller'`, filter.params)).total),
    reportesPendientes: Number((await get(`SELECT COUNT(*) AS total FROM reportes_fallas ${filterAnd} flujo_estatus != 'Caso cerrado'`, filter.params)).total),
    reportesUrgentes: Number((await get(`SELECT COUNT(*) AS total FROM reportes_fallas ${filterAnd} urgencia IN ('Alta', 'Critica') AND flujo_estatus != 'Caso cerrado'`, filter.params)).total),
    presupuestoInicial: presupuesto.asignado,
    presupuestoGastado: presupuesto.gastado,
    presupuestoDisponible: presupuesto.disponible,
    checklistsFaltantes: Number((await get(
      `SELECT COUNT(*) AS total FROM vehiculos v
       WHERE v.id NOT IN (SELECT vehiculo_id FROM checklist_diario WHERE fecha = ?) ${vehicleScope.sql}`,
      [today, ...vehicleScope.params]
    )).total),
    incidenciasPorDepartamento: await all(
      `SELECT d.nombre, COUNT(r.id) AS total
       FROM departamentos d
       LEFT JOIN reportes_fallas r ON r.department_id = d.id AND r.flujo_estatus != 'Caso cerrado'
       ${departmentFilter.sql}
       GROUP BY d.id ORDER BY total DESC LIMIT 5`,
      departmentFilter.params
    )
  });
});

