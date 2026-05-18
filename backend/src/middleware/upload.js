import multer from 'multer';
import path from 'node:path';
import { config } from '../config.js';

const allowed = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'video/mp4',
  'video/quicktime'
]);

const allowedExtensions = new Map([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/webp', new Set(['.webp'])],
  ['application/pdf', new Set(['.pdf'])],
  ['video/mp4', new Set(['.mp4'])],
  ['video/quicktime', new Set(['.mov'])]
]);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (!allowed.has(file.mimetype)) return cb(new Error('Tipo de archivo no permitido'));
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.get(file.mimetype)?.has(ext)) return cb(new Error('Extensión de archivo no permitida'));
    if (/[<>:"/\\|?*\x00-\x1F]/.test(file.originalname)) return cb(new Error('Nombre de archivo no permitido'));
    cb(null, true);
  }
});
