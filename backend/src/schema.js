import { run } from './db.js';

const migrations = [
  `ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS fingerprint TEXT`,
  `ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS ip_change_count INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE sesiones ALTER COLUMN suspicious SET DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS idx_sesiones_usuario_suspicious_created
   ON sesiones (usuario_id, suspicious, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_bitacora_actividad_accion_created
   ON bitacora_actividad (accion, created_at)`
];

export async function migrate() {
  for (const statement of migrations) {
    await run(statement);
  }
  return true;
}
