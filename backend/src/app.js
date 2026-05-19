import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { migrate } from './schema.js';
import { csrf } from './middleware/csrf.js';
import { authRouter } from './routes/auth.js';
import { metaRouter } from './routes/meta.js';
import { vehiclesRouter } from './routes/vehicles.js';
import { reportsRouter } from './routes/reports.js';
import { workshopsRouter } from './routes/workshops.js';
import { checklistsRouter } from './routes/checklists.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportsRouter } from './routes/exports.js';
import { auditRouter } from './routes/audit.js';
import { repairsRouter } from './routes/repairs.js';
import { budgetRouter } from './routes/budget.js';

await migrate();

const app = express();
const allowedOrigin = /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):5173$/;
const allowedFrontendOrigins = new Set(config.frontendOrigins);

app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (config.requireHttps && req.get('x-forwarded-proto') !== 'https' && !req.secure) {
    return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  frameguard: { action: 'deny' },
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", ...config.frontendOrigins, 'http://localhost:4000', 'http://127.0.0.1:4000'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedFrontendOrigins.has(origin) || allowedOrigin.test(origin)) return callback(null, true);
    return callback(new Error('Origen no permitido por CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-captcha-token'],
  credentials: true
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 500, standardHeaders: true, legacyHeaders: false }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(csrf);

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/csrf', (_req, res) => res.json({ csrfToken: res.locals.csrfToken }));
app.use('/api/auth', authRouter);
app.use('/api/meta', metaRouter);
app.use('/api/vehiculos', vehiclesRouter);
app.use('/api/reportes', reportsRouter);
app.use('/api/talleres', workshopsRouter);
app.use('/api/checklists', checklistsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/exportar', exportsRouter);
app.use('/api/auditoria', auditRouter);
app.use('/api/reparaciones', repairsRouter);
app.use('/api/presupuesto', budgetRouter);

app.use((err, _req, res, _next) => {
  if (err instanceof ZodError) return res.status(400).json({ message: 'Datos inválidos', issues: err.issues });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON inválido' });
  if (err?.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ message: 'Puedes subir máximo 5 evidencias por reporte' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: `Cada archivo debe pesar máximo ${config.maxUploadMb} MB` });
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ message: 'Campo de archivo no válido' });
  if (err?.code === '23505' || err?.message?.includes('SQLITE_CONSTRAINT_UNIQUE')) return res.status(409).json({ message: 'Registro duplicado' });
  if (err?.message?.includes('archivo')) return res.status(400).json({ message: err.message });
  if (err?.message === 'Taller no encontrado') return res.status(404).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: 'Error interno del servidor' });
});

export default app;
