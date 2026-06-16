import { Router } from 'express';
import { run } from '../db.js';
import { audit } from '../audit.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { budgetConfigId, budgetSummary, normalizeBudgetMonth } from '../budget.js';
import { streamBudgetReportPdf } from '../budget-report-pdf.js';

export const budgetRouter = Router();

function requestMonth(req) {
  return normalizeBudgetMonth(req.body?.month || req.query?.month);
}

budgetRouter.get('/', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Permiso insuficiente' });
  let month;
  try {
    month = requestMonth(req);
  } catch {
    return res.status(400).json({ message: 'Mes de presupuesto invalido' });
  }
  res.json(await budgetSummary(month));
});

budgetRouter.get('/reporte.pdf', authRequired, requireRole('admin'), async (req, res) => {
  let month;
  try {
    month = requestMonth(req);
  } catch {
    return res.status(400).json({ message: 'Mes de presupuesto invalido' });
  }

  const summary = await budgetSummary(month);
  res.setHeader('Content-Disposition', `attachment; filename="informe-presupuesto-${month}.pdf"`);
  res.type('application/pdf');
  await audit(req, 'descargar_informe_presupuesto', 'presupuesto_config', budgetConfigId(month), { month, movimientos: summary.movimientos.length });
  streamBudgetReportPdf(summary, { user: req.user }, res);
});

budgetRouter.put('/', authRequired, requireRole('admin'), async (req, res) => {
  const monto = Number(req.body.monto);
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ message: 'Captura un presupuesto valido' });

  let month;
  try {
    month = requestMonth(req);
  } catch {
    return res.status(400).json({ message: 'Mes de presupuesto invalido' });
  }

  const current = await budgetSummary(month);
  if (monto < current.gastado) {
    return res.status(400).json({ message: 'El nuevo presupuesto no puede ser menor al gasto ya registrado en ese mes' });
  }

  const id = budgetConfigId(month);
  await run(
    `INSERT INTO presupuesto_config (id, monto, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET monto = EXCLUDED.monto, updated_at = CURRENT_TIMESTAMP`,
    [id, monto]
  );
  await audit(req, 'actualizar_presupuesto', 'presupuesto_config', id, { month, anterior: current.asignado, nuevo: monto });
  res.json(await budgetSummary(month));
});
