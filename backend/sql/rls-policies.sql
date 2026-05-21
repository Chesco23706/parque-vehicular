-- Ejecutar en Supabase SQL Editor despues de validar nombres de tablas/columnas.
-- Estas politicas asumen que la API define:
--   select set_config('app.current_user_id', '<id_usuario>', true);
-- antes de consultar con un rol NO service_role.

alter table vehiculos enable row level security;
alter table reportes_fallas enable row level security;
alter table checklist_diario enable row level security;
alter table reparaciones enable row level security;
alter table bitacora_actividad enable row level security;

create or replace function app_user_role()
returns text
language sql
stable
as $$
  select r.nombre
  from usuarios u
  join roles r on r.id = u.role_id
  where u.id = nullif(current_setting('app.current_user_id', true), '')::int
$$;

create or replace function app_user_department()
returns int
language sql
stable
as $$
  select u.department_id
  from usuarios u
  where u.id = nullif(current_setting('app.current_user_id', true), '')::int
$$;

drop policy if exists vehiculos_por_rol on vehiculos;
create policy vehiculos_por_rol on vehiculos
for all
using (app_user_role() = 'admin' or department_id = app_user_department())
with check (app_user_role() = 'admin' or department_id = app_user_department());

drop policy if exists reportes_por_rol on reportes_fallas;
create policy reportes_por_rol on reportes_fallas
for all
using (app_user_role() in ('admin', 'taller') or department_id = app_user_department())
with check (app_user_role() = 'admin' or department_id = app_user_department());

drop policy if exists checklist_por_rol on checklist_diario;
create policy checklist_por_rol on checklist_diario
for all
using (app_user_role() = 'admin' or department_id = app_user_department())
with check (app_user_role() = 'admin' or department_id = app_user_department());

drop policy if exists reparaciones_por_rol on reparaciones;
create policy reparaciones_por_rol on reparaciones
for all
using (app_user_role() = 'admin' or department_id = app_user_department())
with check (app_user_role() = 'admin' or department_id = app_user_department());

drop policy if exists bitacora_por_rol on bitacora_actividad;
create policy bitacora_por_rol on bitacora_actividad
for select
using (
  app_user_role() = 'admin'
  or usuario_id = nullif(current_setting('app.current_user_id', true), '')::int
  or exists (
    select 1
    from usuarios u
    where u.id = bitacora_actividad.usuario_id
      and u.department_id = app_user_department()
  )
);

drop policy if exists bitacora_insert_api on bitacora_actividad;
create policy bitacora_insert_api on bitacora_actividad
for insert
with check (true);
