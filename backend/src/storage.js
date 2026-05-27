import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';
import { config } from './config.js';

const allowedExtensions = new Map([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/webp', new Set(['.webp'])],
  ['application/pdf', new Set(['.pdf'])],
  ['video/mp4', new Set(['.mp4'])],
  ['video/quicktime', new Set(['.mov'])]
]);

const client = config.supabaseUrl && config.supabaseServiceRoleKey
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function requireStorage() {
  if (!client) {
    throw new Error('Falta configurar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir archivos');
  }
  return client.storage;
}

function validateFileMeta(fileName, mimeType, sizeBytes) {
  const cleanFileName = String(fileName || '').trim();
  const cleanMimeType = String(mimeType || '').trim();
  const numericSize = Number(sizeBytes || 0);
  if (!cleanFileName || /[<>:"/\\|?*\x00-\x1F]/.test(cleanFileName)) throw new Error('Nombre de archivo no permitido');
  if (!allowedExtensions.has(cleanMimeType)) throw new Error('Tipo de archivo no permitido');
  const ext = path.extname(cleanFileName).toLowerCase();
  if (!allowedExtensions.get(cleanMimeType)?.has(ext)) throw new Error('Extensión de archivo no permitida');
  if (!Number.isFinite(numericSize) || numericSize <= 0) throw new Error('Tamaño de archivo no válido');
  if (numericSize > config.maxUploadMb * 1024 * 1024) throw new Error(`Cada archivo debe pesar máximo ${config.maxUploadMb} MB`);
  return { cleanFileName, cleanMimeType, numericSize, ext };
}

export async function uploadFile(bucket, file, prefix = 'general') {
  if (!file) return null;
  const { cleanFileName, cleanMimeType, numericSize, ext } = validateFileMeta(file.originalname, file.mimetype, file.size);
  const storedName = `${prefix}/${new Date().toISOString().slice(0, 10)}/${uuid()}${ext}`;
  const { error } = await requireStorage().from(bucket).upload(storedName, file.buffer, {
    contentType: cleanMimeType,
    upsert: false
  });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  return {
    bucket,
    storedName,
    fileName: cleanFileName,
    mimeType: cleanMimeType,
    sizeBytes: numericSize
  };
}

export async function createSignedUpload(bucket, fileMeta, prefix = 'general') {
  const { cleanFileName, cleanMimeType, numericSize, ext } = validateFileMeta(fileMeta.fileName, fileMeta.mimeType, fileMeta.sizeBytes);
  const storedName = `${prefix}/${new Date().toISOString().slice(0, 10)}/${uuid()}${ext}`;
  const { data, error } = await requireStorage().from(bucket).createSignedUploadUrl(storedName);
  if (error) throw new Error(`No se pudo preparar la subida: ${error.message}`);
  return {
    bucket,
    storedName,
    fileName: cleanFileName,
    mimeType: cleanMimeType,
    sizeBytes: numericSize,
    signedUrl: data.signedUrl,
    token: data.token
  };
}

export async function removeFiles(bucket, paths = []) {
  const cleanPaths = paths.filter(Boolean);
  if (!cleanPaths.length) return 0;
  const { error } = await requireStorage().from(bucket).remove(cleanPaths);
  if (error) throw new Error(`No se pudieron eliminar archivos: ${error.message}`);
  return cleanPaths.length;
}

export async function downloadFile(bucket, storedName) {
  const { data, error } = await requireStorage().from(bucket).download(storedName);
  if (error) return null;
  return Buffer.from(await data.arrayBuffer());
}
