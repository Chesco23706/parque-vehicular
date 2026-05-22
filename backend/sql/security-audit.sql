-- Auditoria de seguridad para Supabase.
-- Ejecutar en SQL Editor con rol administrador.
-- No modifica datos.

select
  current_database() as database_name,
  current_schema() as schema_name,
  current_user as current_user;

select
  r.rolname,
  r.rolsuper,
  r.rolcreaterole,
  r.rolcreatedb,
  r.rolcanlogin,
  r.rolbypassrls
from pg_roles r
where r.rolname in ('app_api', 'postgres', 'anon', 'authenticated', 'service_role')
order by r.rolname;

select
  grantee,
  table_schema,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('app_api', 'anon', 'authenticated', 'public')
group by grantee, table_schema, table_name
order by grantee, table_name;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

