import { all, get } from './db.js';

export async function budgetSummary() {
  const current = await get('SELECT monto FROM presupuesto_config WHERE id = 1');
  const asignado = Number(current?.monto || 80000);
  const asignaciones = Number((await get('SELECT COALESCE(SUM(cotizacion_total), 0) AS total FROM asignaciones_taller')).total || 0);
  const reparaciones = Number((await get('SELECT COALESCE(SUM(cotizacion_total), 0) AS total FROM reparaciones WHERE reporte_id IS NULL')).total || 0);
  const gastado = asignaciones + reparaciones;
  return {
    asignado,
    gastado,
    disponible: asignado - gastado,
    porcentajeUsado: asignado > 0 ? Math.min(100, Math.round((gastado / asignado) * 100)) : 0,
    movimientos: await all(
      `SELECT a.id, a.cotizacion_total, a.cotizacion_registrada_at, a.created_at,
              COALESCE(a.cotizacion_registrada_at, a.created_at) AS fecha_movimiento,
              COALESCE(t.nombre, 'Sin taller asignado') AS taller, v.numero_economico, r.tipo_falla, r.urgencia
       FROM asignaciones_taller a
       LEFT JOIN talleres t ON t.id = a.taller_id
       JOIN vehiculos v ON v.id = a.vehiculo_id
       JOIN reportes_fallas r ON r.id = a.reporte_id
       WHERE COALESCE(a.cotizacion_total, 0) > 0
       UNION ALL
       SELECT rep.id, rep.cotizacion_total, rep.cotizacion_registrada_at, rep.created_at,
              COALESCE(rep.cotizacion_registrada_at, rep.created_at) AS fecha_movimiento,
              rep.taller_nombre AS taller, v.numero_economico, 'Reparacion' AS tipo_falla, rep.estatus AS urgencia
       FROM reparaciones rep
       JOIN vehiculos v ON v.id = rep.vehiculo_id
       WHERE rep.reporte_id IS NULL AND COALESCE(rep.cotizacion_total, 0) > 0
       ORDER BY fecha_movimiento DESC`
    )
  };
}

