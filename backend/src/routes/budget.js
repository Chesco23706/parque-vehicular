import { Router } from 'express';
import { run } from '../db.js';
import { audit } from '../audit.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { budgetSummary } from '../budget.js';

export const budgetRouter = Router();

budgetRouter.get('/', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Permiso insuficiente' });
  res.json(await budgetSummary());
});

budgetRouter.put('/', authRequired, requireRole('admin'), async (req, res) => {
  const monto = Number(req.body.monto);
  if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ message: 'Captura un presupuesto válido' });
  const current = await budgetSummary();
  if (monto < current.gastado) return res.status(400).json({ message: 'El nuevo presupuesto no puede ser menor al gasto ya registrado' });

  await run('UPDATE presupuesto_config SET monto = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1', [monto]);
  await audit(req, 'actualizar_presupuesto', 'presupuesto_config', 1, { anterior: current.asignado, nuevo: monto });
  res.json(await budgetSummary());
});

