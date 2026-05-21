-- Ejecutar una sola vez en Supabase SQL Editor con permisos de administrador.
-- En produccion RUN_MIGRATIONS debe estar en false para que app_api no ejecute DDL.

alter table sesiones add column if not exists fingerprint text;
alter table sesiones add column if not exists ip_change_count integer not null default 0;
alter table sesiones alter column suspicious set default false;

create index if not exists idx_sesiones_usuario_suspicious_created
on sesiones (usuario_id, suspicious, created_at);

create index if not exists idx_bitacora_actividad_accion_created
on bitacora_actividad (accion, created_at);
