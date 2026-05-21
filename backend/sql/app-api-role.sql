-- Ejecutar en Supabase SQL Editor con un usuario administrador.
-- Cambia la contrasena antes de ejecutar.

do $$
declare
  writable_tables text[] := array[
    'vehiculos',
    'reportes_fallas',
    'checklist_diario',
    'evidencias_checklist',
    'evidencias_reportes',
    'reparaciones',
    'asignaciones_taller',
    'seguimiento_reportes',
    'historial_estatus',
    'talleres',
    'presupuesto_config',
    'password_reset_tokens',
    'email_verification_tokens',
    'sesiones',
    'bitacora_actividad'
  ];
  readable_tables text[] := array[
    'usuarios',
    'roles',
    'departamentos'
  ];
  table_name text;
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api login password 'CAMBIA_ESTA_CONTRASENA_LARGA';
  end if;

  grant usage on schema public to app_api;

  foreach table_name in array writable_tables loop
    if to_regclass('public.' || table_name) is not null then
      execute format('grant select, insert, update, delete on public.%I to app_api', table_name);
    end if;
  end loop;

  foreach table_name in array readable_tables loop
    if to_regclass('public.' || table_name) is not null then
      execute format('grant select on public.%I to app_api', table_name);
    end if;
  end loop;

  if to_regclass('public.usuarios') is not null then
    grant update on public.usuarios to app_api;
  end if;

  grant usage, select on all sequences in schema public to app_api;
end $$;
