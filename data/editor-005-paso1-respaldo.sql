-- =============================================================================
-- ELDOSTORE · 005 · PASO 1: RESPALDO COMPLETO (solo lectura)
-- Supabase → SQL Editor → pegar todo → Run → Export → CSV → guardar el archivo.
--
-- Devuelve una fila por cada tabla del esquema public con TODOS sus registros
-- (columna "datos", en JSON), la cantidad de filas y un código de control.
-- Al final agrega una fila "_funciones" con el código de todas las funciones.
-- No cambia nada: solo lee. Usa una función auxiliar temporal (pg_temp) que
-- desaparece sola al cerrar la conexión.
-- Si no es el proyecto de producción de ELDOSTORE, se detiene con un aviso.
-- No incluye: usuarios de acceso (auth) ni fotos (Storage); la 005 no los toca.
-- =============================================================================

-- Control de proyecto: tiene que ser la base real de ELDOSTORE
do $control$
begin
  if to_regclass('public.products') is null or to_regclass('public.sales') is null
     or to_regclass('public.app_users') is null or to_regclass('public.eldo_base_de_pruebas') is not null
     or (select count(*) from public.app_users a join auth.users u on u.id = a.user_id
          where a.es_admin and a.activo and md5(lower(u.email)) = '4f2cdd47c53fad5f03e82094f7613fb0') <> 1 then
    raise exception 'ESTE NO ES EL PROYECTO DE PRODUCCIÓN DE ELDOSTORE. No se hizo nada.';
  end if;
end
$control$;

create or replace function pg_temp.eldo_datos(t text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), ''[]''::jsonb) from public.%I x', t) into r;
  return r;
end $f$;

select tabla, jsonb_array_length(datos) as filas, md5(datos::text) as control, datos
from (
  select table_name::text as tabla, pg_temp.eldo_datos(table_name) as datos
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  union all
  select '_funciones', coalesce(jsonb_agg(jsonb_build_object('funcion', p.oid::regprocedure::text,
           'definicion', pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text), '[]')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
) x
order by tabla;
