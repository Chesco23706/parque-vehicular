-- Ejecutar en Supabase SQL Editor despues de validar nombres de tablas/columnas.
-- Estas politicas asumen que la API define:
--   select set_config('app.current_user_id', '<id_usuario>', true);
-- antes de consultar con un rol NO service_role.

alter table vehiculos enable row level security;
alter table departamentos enable row level security;
alter table reportes_fallas enable row level security;
alter table checklist_diario enable row level security;
alter table evidencias_checklist enable row level security;
alter table evidencias_reportes enable row level security;
alter table seguimiento_reportes enable row level security;
alter table asignaciones_taller enable row level security;
alter table reparaciones enable row level security;
alter table historial_estatus enable row level security;
alter table bitacora_actividad enable row level security;
alter table talleres enable row level security;
alter table presupuesto_config enable row level security;

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

drop policy if exists departamentos_por_rol on departamentos;
create policy departamentos_por_rol on departamentos
for select
using (app_user_role() = 'admin' or id = app_user_department());

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

drop policy if exists evidencias_checklist_por_rol on evidencias_checklist;
create policy evidencias_checklist_por_rol on evidencias_checklist
for all
using (
  app_user_role() = 'admin'
  or exists (
    select 1
    from checklist_diario c
    where c.id = evidencias_checklist.checklist_id
      and c.department_id = app_user_department()
  )
)
with check (
  app_user_role() = 'admin'
  or exists (
    select 1
    from checklist_diario c
    where c.id = evidencias_checklist.checklist_id
      and c.department_id = app_user_department()
  )
);

drop policy if exists evidencias_reportes_por_rol on evidencias_reportes;
create policy evidencias_reportes_por_rol on evidencias_reportes
for all
using (
  app_user_role() in ('admin', 'taller')
  or exists (
    select 1
    from reportes_fallas r
    where r.id = evidencias_reportes.reporte_id
      and r.department_id = app_user_department()
  )
)
with check (
  app_user_role() = 'admin'
  or exists (
    select 1
    from reportes_fallas r
    where r.id = evidencias_reportes.reporte_id
      and r.department_id = app_user_department()
  )
);

drop policy if exists seguimiento_reportes_por_rol on seguimiento_reportes;
create policy seguimiento_reportes_por_rol on seguimiento_reportes
for all
using (
  app_user_role() in ('admin', 'taller')
  or exists (
    select 1
    from reportes_fallas r
    where r.id = seguimiento_reportes.reporte_id
      and r.department_id = app_user_department()
  )
)
with check (
  app_user_role() in ('admin', 'taller')
  or exists (
    select 1
    from reportes_fallas r
    where r.id = seguimiento_reportes.reporte_id
      and r.department_id = app_user_department()
  )
);

drop policy if exists asignaciones_taller_por_rol on asignaciones_taller;
create policy asignaciones_taller_por_rol on asignaciones_taller
for all
using (
  app_user_role() in ('admin', 'taller')
  or exists (
    select 1
    from reportes_fallas r
    where r.id = asignaciones_taller.reporte_id
      and r.department_id = app_user_department()
  )
  or exists (
    select 1
    from vehiculos v
    where v.id = asignaciones_taller.vehiculo_id
      and v.department_id = app_user_department()
  )
)
with check (
  app_user_role() = 'admin'
  or exists (
    select 1
    from reportes_fallas r
    where r.id = asignaciones_taller.reporte_id
      and r.department_id = app_user_department()
  )
  or exists (
    select 1
    from vehiculos v
    where v.id = asignaciones_taller.vehiculo_id
      and v.department_id = app_user_department()
  )
);

drop policy if exists historial_estatus_por_rol on historial_estatus;
create policy historial_estatus_por_rol on historial_estatus
for all
using (
  app_user_role() = 'admin'
  or exists (
    select 1
    from vehiculos v
    where v.id = historial_estatus.vehiculo_id
      and v.department_id = app_user_department()
  )
)
with check (
  app_user_role() = 'admin'
  or exists (
    select 1
    from vehiculos v
    where v.id = historial_estatus.vehiculo_id
      and v.department_id = app_user_department()
  )
);

drop policy if exists talleres_por_rol on talleres;
create policy talleres_por_rol on talleres
for all
using (app_user_role() in ('admin', 'taller'))
with check (app_user_role() = 'admin');

drop policy if exists presupuesto_config_admin on presupuesto_config;
create policy presupuesto_config_admin on presupuesto_config
for all
using (app_user_role() = 'admin')
with check (app_user_role() = 'admin');

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
to public
with check (true);
