-- =============================================================================
-- ELDOSTORE · 005 · PASO 2 y PASO 4: HUELLA DE LOS DATOS (solo lectura)
-- Correrlo ANTES de instalar la 005 y otra vez DESPUÉS.
-- El "codigo" tiene que ser IDÉNTICO las dos veces: eso prueba que ningún
-- producto, precio, costo, stock, código, venta, caja, cuenta, cliente, compra,
-- gasto ni usuario del panel cambió. (Las 6 tablas nuevas de la 005 no se cuentan.)
-- No cambia nada: solo lee. Usa una función auxiliar temporal (pg_temp).
-- Mientras tanto, no cargar ventas ni editar nada en el panel.
-- =============================================================================

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

create or replace function pg_temp.eldo_huella(t text) returns text language plpgsql as $f$
declare r text;
begin
  execute format('select count(*)::text || '':'' || md5(coalesce(string_agg(x::text, chr(10) order by x::text), '''')) from public.%I x', t) into r;
  return r;
end $f$;

with tablas as (
  select table_name::text as t, pg_temp.eldo_huella(table_name) as h
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
    and table_name not in ('promo_banners', 'categorias_tienda', 'descuentos_producto', 'ofertas_flash',
                           'ofertas_flash_productos', 'ventas_descuentos')
),
preparado as (
  select array_remove(array[
    case when to_regprocedure('public.register_sale_v3(uuid, jsonb, text, text, uuid)') is null then 'falta register_sale_v3 (V003)' end,
    case when to_regprocedure('public.eldo_auditar(text, text, uuid, jsonb)') is null then 'falta eldo_auditar (V003)' end,
    case when to_regprocedure('public.catalogo_tienda()') is null then 'falta catalogo_tienda()' end,
    case when exists (select 1 from public.products where length(btrim(coalesce(categoria, ''))) > 60)
         then 'hay categorías de más de 60 letras' end,
    case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
         and p.proname in ('guardar_banner', 'promociones_tienda', 'promociones_panel', 'registrar_venta_promocion',
                           'poner_descuento', 'guardar_categoria', 'eldo_descuento_en'))
          and to_regclass('public.promo_banners') is null then 'ya existen funciones con nombres de la 005' end
  ], null) as faltas
)
select
  'ELDOSTORE producción ✔' as proyecto,
  case when to_regclass('public.promo_banners') is null then 'NO instalada' else 'INSTALADA' end as migracion_005,
  (select count(*) from tablas) as tablas,
  (select sum(split_part(h, ':', 1)::bigint) from tablas) as filas,
  (select md5(string_agg(t || '=' || h, ',' order by t)) from tablas) as codigo,
  (select count(*) from public.products) as productos,
  (select count(*) from public.sales) as ventas,
  case when to_regclass('public.promo_banners') is not null then '—'
       when cardinality(faltas) = 0 then 'sí' else 'NO: ' || array_to_string(faltas, '; ') end as listo_para_instalar
from preparado;
