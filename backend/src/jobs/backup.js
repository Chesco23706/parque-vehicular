import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { sendSecurityAlert } from '../security.js';

const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} salio con codigo ${code}`));
    });
  });
}

async function uploadBackup(filePath, objectName) {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para subir backups');
  }
  const client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const data = await fs.readFile(filePath);
  const { error } = await client.storage.from(config.backupBucket).upload(objectName, data, {
    contentType: 'application/octet-stream',
    upsert: false
  });
  if (error) throw new Error(error.message);
  return client;
}

async function pruneBackups(client) {
  const { data, error } = await client.storage.from(config.backupBucket).list('database', { limit: 1000 });
  if (error) throw new Error(error.message);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const oldObjects = (data || [])
    .filter((item) => item.name.endsWith('.dump') && new Date(item.created_at || item.updated_at || 0).getTime() < cutoff)
    .map((item) => `database/${item.name}`);
  if (!oldObjects.length) return 0;
  const { error: removeError } = await client.storage.from(config.backupBucket).remove(oldObjects);
  if (removeError) throw new Error(removeError.message);
  return oldObjects.length;
}

export async function runBackup() {
  if (!config.databaseUrl) throw new Error('Falta DATABASE_URL');
  const pgDump = process.env.PG_DUMP_PATH || 'pg_dump';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `parque-vehicular-${timestamp}.dump`;
  const filePath = path.join(os.tmpdir(), fileName);

  await runCommand(pgDump, ['--format=custom', '--no-owner', '--no-acl', '--dbname', config.databaseUrl, '--file', filePath]);
  const client = await uploadBackup(filePath, `database/${fileName}`);
  const pruned = await pruneBackups(client);
  await fs.rm(filePath, { force: true });
  await sendSecurityAlert('backup_generado', { objectName: `database/${fileName}`, pruned }, 'medium');
  return { objectName: `database/${fileName}`, pruned };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBackup()
    .then((result) => {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    })
    .catch(async (error) => {
      await sendSecurityAlert('backup_fallido', { message: error.message }, 'critical');
      console.error(error);
      process.exitCode = 1;
    });
}
