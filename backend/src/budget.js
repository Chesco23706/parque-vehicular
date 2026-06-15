import { all, get } from './db.js';
import { todayLocal } from './date.js';

const DEFAULT_BUDGET = 80000;
const LEGACY_BUDGET_ID = 1;

export function normalizeBudgetMonth(month = todayLocal().slice(0, 7)) {
  const text = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(text)) throw new Error('Mes de presupuesto invalido');

  const year = Number(text.slice(0, 4));
  const monthNumber = Number(text.slice(5, 7));
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2100 || monthNumber < 1 || monthNumber > 12) {
    throw new Error('Mes de presupuesto invalido');
  }
  return text;
}

export function budgetMonthFromDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return normalizeBudgetMonth(value.toISOString().slice(0, 7));

  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})/);
  if (!match) return normalizeBudgetMonth();
  return normalizeBudgetMonth(`${match[1]}-${match[2]}`);
}

export function budgetConfigId(month) {
  return Number(normalizeBudgetMonth(month).replace('-', ''));
}

export async function monthlyBudgetAmount(month) {
  const normalizedMonth = normalizeBudgetMonth(month);
  const monthly = await get('SELECT monto FROM presupuesto_config WHERE id = ?', [budgetConfigId(normalizedMonth)]);
  if (monthly) return Number(monthly.monto || DEFAULT_BUDGET);

  const current = await get('SELECT monto FROM presupuesto_config WHERE id = ?', [LEGACY_BUDGET_ID]);
  return Number(current?.monto || DEFAULT_BUDGET);
}

export async function budgetSummary(month = normalizeBudgetMonth()) {
  const normalizedMonth = normalizeBudgetMonth(month);
  const asignado = await monthlyBudgetAmount(normalizedMonth);
  const asignaciones = Number((await get(
    `SELECT COALESCE(SUM(COALESCE(a.cotizacion_total, a.costo_estimado, 0)), 0) AS total
     FROM asignaciones_taller a
     JOIN reportes_fallas r ON r.id = a.reporte_id
     WHERE to_char(r.created_at, 'YYYY-MM') = ?`,
    [normalizedMonth]
  )).total || 0);
  const reparaciones = Number((await get(
    `SELECT COALESCE(SUM(cotizacion_total), 0) AS total
     FROM reparaciones
     WHERE reporte_id IS NULL AND to_char(fecha_ingreso::date, 'YYYY-MM') = ?`,
    [normalizedMonth]
  )).total || 0);
  const gastado = asignaciones + reparaciones;

  return {
    month: normalizedMonth,
    asignado,
    gastado,
    disponible: asignado - gastado,
    porcentajeUsado: asignado > 0 ? Math.min(100, Math.round((gastado / asignado) * 100)) : 0,
    movimientos: await all(
      `SELECT ('asignacion-' || a.id::text) AS id, a.id AS origen_id, 'reporte' AS tipo_movimiento,
              r.id AS reporte_id, NULL::integer AS reparacion_id,
              COALESCE(a.cotizacion_total, a.costo_estimado, 0) AS cotizacion_total, a.cotizacion_registrada_at, a.created_at,
              COALESCE(a.cotizacion_registrada_at, a.created_at) AS fecha_movimiento,
              r.created_at AS fecha_presupuesto,
              a.fecha_ingreso, a.fecha_estimada_entrega,
              COALESCE(t.nombre, 'Sin taller asignado') AS taller,
              v.numero_economico, v.tipo AS vehiculo_tipo, v.marca, v.modelo, v.placas,
              d.nombre AS departamento, u.nombre AS usuario,
              r.tipo_falla, r.urgencia, r.flujo_estatus AS estatus,
              r.descripcion, a.observaciones
       FROM asignaciones_taller a
       LEFT JOIN talleres t ON t.id = a.taller_id
       JOIN vehiculos v ON v.id = a.vehiculo_id
       JOIN reportes_fallas r ON r.id = a.reporte_id
       JOIN departamentos d ON d.id = r.department_id
       JOIN usuarios u ON u.id = r.usuario_id
       WHERE COALESCE(a.cotizacion_total, a.costo_estimado, 0) > 0 AND to_char(r.created_at, 'YYYY-MM') = ?
       UNION ALL
       SELECT ('reparacion-' || rep.id::text) AS id, rep.id AS origen_id, 'reparacion' AS tipo_movimiento,
              NULL::integer AS reporte_id, rep.id AS reparacion_id,
              rep.cotizacion_total, rep.cotizacion_registrada_at, rep.created_at,
              COALESCE(rep.cotizacion_registrada_at, rep.created_at) AS fecha_movimiento,
              rep.fecha_ingreso::date AS fecha_presupuesto,
              rep.fecha_ingreso, rep.fecha_estimada_entrega,
              rep.taller_nombre AS taller,
              v.numero_economico, v.tipo AS vehiculo_tipo, v.marca, v.modelo, v.placas,
              d.nombre AS departamento, u.nombre AS usuario,
              'Reparacion' AS tipo_falla, rep.estatus AS urgencia, rep.estatus AS estatus,
              rep.descripcion, rep.observaciones
       FROM reparaciones rep
       JOIN vehiculos v ON v.id = rep.vehiculo_id
       JOIN departamentos d ON d.id = rep.department_id
       JOIN usuarios u ON u.id = rep.usuario_id
       WHERE rep.reporte_id IS NULL AND COALESCE(rep.cotizacion_total, 0) > 0 AND to_char(rep.fecha_ingreso::date, 'YYYY-MM') = ?
       ORDER BY fecha_presupuesto DESC, fecha_movimiento DESC`,
      [normalizedMonth, normalizedMonth]
    )
  };
}

export function budgetSummaryForDate(value) {
  return budgetSummary(budgetMonthFromDate(value));
}
