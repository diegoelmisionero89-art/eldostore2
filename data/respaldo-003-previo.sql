-- =============================================================================
-- ELDOSTORE — Respaldo previo a la migración 003 (dentro de la misma base)
--
-- Copia TODAS las tablas del esquema public, las definiciones de las funciones y las
-- políticas actuales a un esquema aparte, "respaldo_003". No modifica ni borra nada
-- de lo existente. El esquema respaldo_003 no es accesible desde la web (la API de
-- Supabase solo publica "public") y además se le quitan los permisos a anon/authenticated.
--
-- Correr ANTES de la migración. Si ya existe respaldo_003, se detiene (no pisa un
-- respaldo anterior). Al final muestra cuántas filas se copiaron de cada tabla.
-- Cuando V003 esté funcionando y ya no lo necesites:  drop schema respaldo_003 cascade;
-- =============================================================================
begin;

do $respaldo$
declare t record;
begin
  if exists (select 1 from pg_namespace where nspname = 'respaldo_003') then
    raise exception 'Ya existe un respaldo (esquema respaldo_003). No se hizo nada.';
  end if;
  execute 'create schema respaldo_003';
  for t in select table_name from information_schema.tables
           where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name loop
    execute format('create table respaldo_003.%I as table public.%I', t.table_name, t.table_name);
  end loop;

  create table respaldo_003._funciones as
    select p.oid::regprocedure::text as firma, p.prosecdef as security_definer, p.proacl::text as permisos,
           pg_get_functiondef(p.oid) as definicion
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f';
  create table respaldo_003._politicas as select * from pg_policies where schemaname in ('public', 'storage');
  create table respaldo_003._info as select now() as respaldado_el, current_user as por, version() as postgres;
end
$respaldo$;

revoke all on schema respaldo_003 from public;
do $permisos$ begin
  execute 'revoke all on schema respaldo_003 from anon, authenticated';
exception when undefined_object then null;  -- fuera de Supabase esos roles pueden no existir
end $permisos$;

commit;

-- Control: filas copiadas por tabla (comparar con el original)
select c.relname as tabla,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from respaldo_003.%I', c.relname), false, true, '')))[1]::text::bigint as filas_respaldo,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint as filas_original
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'respaldo_003' and c.relkind = 'r' and c.relname not like '\_%'
order by 1;
