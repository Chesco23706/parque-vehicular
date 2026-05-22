-- Politica de retencion operativa.
-- Ajusta los intervalos segun contrato/cliente antes de ejecutar en produccion.

create or replace function cleanup_operational_retention()
returns table (
  deleted_audit bigint,
  deleted_sessions bigint,
  deleted_password_resets bigint,
  deleted_email_verifications bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_count bigint := 0;
  session_count bigint := 0;
  reset_count bigint := 0;
  email_count bigint := 0;
begin
  -- Bitacora: conservar 180 dias por defecto.
  if to_regclass('public.bitacora_actividad') is not null then
    delete from bitacora_actividad
    where created_at < now() - interval '180 days';
    get diagnostics audit_count = row_count;
  end if;

  -- Sesiones revocadas o expiradas: conservar 30 dias.
  if to_regclass('public.sesiones') is not null then
    delete from sesiones
    where coalesce(revoked_at, expires_at) < now() - interval '30 days';
    get diagnostics session_count = row_count;
  end if;

  -- Tokens de reset: conservar 7 dias despues de expirar/usarse.
  if to_regclass('public.password_reset_tokens') is not null then
    delete from password_reset_tokens
    where coalesce(used_at, expires_at) < now() - interval '7 days';
    get diagnostics reset_count = row_count;
  end if;

  -- Tokens de verificacion: conservar 7 dias despues de expirar/usarse.
  if to_regclass('public.email_verification_tokens') is not null then
    delete from email_verification_tokens
    where coalesce(used_at, expires_at) < now() - interval '7 days';
    get diagnostics email_count = row_count;
  end if;

  return query select audit_count, session_count, reset_count, email_count;
end;
$$;

-- Ejecucion manual:
-- select * from cleanup_operational_retention();

-- Si tu proyecto tiene pg_cron habilitado, puedes programarlo asi:
-- select cron.schedule(
--   'cleanup_operational_retention_daily',
--   '30 3 * * *',
--   $$select * from cleanup_operational_retention();$$
-- );

