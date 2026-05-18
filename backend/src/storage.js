import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuid } from 'uuid';
import { config } from './config.js';

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

export async function uploadFile(bucket, file, prefix = 'general') {
  if (!file) return null;
  const ext = path.extname(file.originalname).toLowerCase();
  const storedName = `${prefix}/${new Date().toISOString().slice(0, 10)}/${uuid()}${ext}`;
  const { error } = await requireStorage().from(bucket).upload(storedName, file.buffer, {
    contentType: file.mimetype,
    upsert: false
  });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  return {
    bucket,
    storedName,
    fileName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size
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
