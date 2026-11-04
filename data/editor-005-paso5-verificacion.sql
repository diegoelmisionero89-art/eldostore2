-- =============================================================================
-- ELDOSTORE · 005 · PASO 5: VERIFICACIÓN (solo lectura, no registra nada)
-- Correrlo después de instalar la 005. No hace ventas, no toca productos, stock,
-- caja ni cuentas: solo consulta permisos, estructura y reglas de consistencia.
-- Resultado: una lista de controles; TODOS tienen que decir OK.
-- =============================================================================

do $control$
begin
  if to_regclass('public.products') is null or to_regclass('public.sales') is null
     or to_regclass('public.app_users') is null or to_regclass('public.eldo_base_de_pruebas') is not null
     or (select count(*) from public.app_users a join auth.users u on u.id = a.user_id
          where a.es_admin and a.activo and md5(lower(u.email)) = '4f2cdd47c53fad5f03e82094f7613fb0') <> 1 then
    raise exception 'ESTE NO ES EL PROYECTO DE PRODUCCIÓN DE ELDOSTORE. No se hizo nada.';
  end if;
  if to_regclass('public.promo_banners') is null then
    raise exception 'La migración 005 no está instalada todavía.';
  end if;
end
$control$;

with
tablas as (select unnest(array['promo_banners','categorias_tienda','descuentos_producto','ofertas_flash',
                               'ofertas_flash_productos','ventas_descuentos']) as t),
funciones as (select unnest(array[
  'eldo_descuento_en(uuid,timestamp with time zone)', 'eldo_precio_con_descuento(numeric,integer)', 'eldo_requiere_admin()',
  'guardar_banner(uuid,text,text,text,text,text,boolean)', 'ordenar_banners(text,uuid[])', 'eliminar_banner(uuid)',
  'guardar_categoria(uuid,text,text,boolean)', 'ordenar_categorias(uuid[])', 'reasignar_categoria(uuid,uuid)',
  'eliminar_categoria(uuid)', 'poner_descuento(uuid,integer,timestamp with time zone)', 'quitar_descuento(uuid)',
  'guardar_oferta_flash(text,timestamp with time zone,timestamp with time zone,jsonb)', 'terminar_oferta_flash()',
  'promociones_tienda()', 'promociones_panel(timestamp with time zone)',
  'registrar_venta_promocion(uuid,jsonb,text,text,uuid,timestamp with time zone)']) as f),
solo_admin as (select unnest(array[
  'guardar_banner(uuid,text,text,text,text,text,boolean)', 'ordenar_banners(text,uuid[])', 'eliminar_banner(uuid)',
  'guardar_categoria(uuid,text,text,boolean)', 'ordenar_categorias(uuid[])', 'reasignar_categoria(uuid,uuid)',
  'eliminar_categoria(uuid)', 'poner_descuento(uuid,integer,timestamp with time zone)', 'quitar_descuento(uuid)',
  'guardar_oferta_flash(text,timestamp with time zone,timestamp with time zone,jsonb)', 'terminar_oferta_flash()']) as f),
del_panel as (select unnest(array[
  'promociones_panel(timestamp with time zone)', 'guardar_banner(uuid,text,text,text,text,text,boolean)',
  'ordenar_banners(text,uuid[])', 'eliminar_banner(uuid)', 'guardar_categoria(uuid,text,text,boolean)',
  'ordenar_categorias(uuid[])', 'reasignar_categoria(uuid,uuid)', 'eliminar_categoria(uuid)',
  'poner_descuento(uuid,integer,timestamp with time zone)', 'quitar_descuento(uuid)',
  'guardar_oferta_flash(text,timestamp with time zone,timestamp with time zone,jsonb)', 'terminar_oferta_flash()',
  'registrar_venta_promocion(uuid,jsonb,text,text,uuid,timestamp with time zone)']) as f),
tienda as (select public.promociones_tienda() as j),
controles (n, control, ok) as (
  select 1, 'Las 6 tablas nuevas existen', (select count(*) from tablas where to_regclass('public.' || t) is not null) = 6
  union all select 2, 'Las 17 funciones nuevas existen', (select count(*) from funciones where to_regprocedure('public.' || f) is not null) = 17
  union all select 3, 'Las tablas nuevas tienen seguridad por filas (RLS)',
    (select bool_and(c.relrowsecurity) from tablas join pg_class c on c.oid = ('public.' || t)::regclass)
  union all select 4, 'La tienda (anon) no puede leer ni escribir las tablas nuevas',
    not (select bool_or(has_table_privilege('anon', 'public.' || t, p)) from tablas, unnest(array['select','insert','update','delete']) p)
  union all select 5, 'Los usuarios del panel no pueden escribir directo en las tablas nuevas',
    not (select bool_or(has_table_privilege('authenticated', 'public.' || t, p)) from tablas, unnest(array['insert','update','delete','truncate']) p)
  union all select 6, 'La tienda solo puede usar promociones_tienda()',
    has_function_privilege('anon', 'public.promociones_tienda()', 'execute')
    and not (select bool_or(has_function_privilege('anon', ('public.' || f)::regprocedure, 'execute')) from funciones where f <> 'promociones_tienda()')
  union all select 7, 'El panel puede usar sus funciones',
    (select bool_and(has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'execute')) from del_panel)
  union all select 8, 'Las 11 funciones de cambios exigen al administrador',
    (select count(*) from solo_admin join pg_proc p on p.oid = ('public.' || f)::regprocedure
      where p.prosrc like '%perform eldo_requiere_admin();%' and p.prosecdef) = 11
  union all select 9, 'Un único administrador activo: Diego',
    (select count(*) from public.app_users where es_admin and activo) = 1
    and (select count(*) from public.app_users a join auth.users u on u.id = a.user_id
          where a.es_admin and a.activo and md5(lower(u.email)) = '4f2cdd47c53fad5f03e82094f7613fb0') = 1
  union all select 10, 'eldo_es_admin() sigue sin poder usarse desde el navegador (V003)',
    not has_function_privilege('anon', 'public.eldo_es_admin()', 'execute')
    and not has_function_privilege('authenticated', 'public.eldo_es_admin()', 'execute')
  union all select 11, 'Precio con descuento al peso: 33.475 − 20 % = 26.780 y 1.999 − 35 % = 1.299',
    public.eldo_precio_con_descuento(33475, 20) = 26780 and public.eldo_precio_con_descuento(1999, 35) = 1299
  union all select 12, 'La tienda recibe las promociones (con hora del servidor)',
    (select j ? 'ahora' and j ? 'banners' and j ? 'categorias' and j ? 'descuentos' from tienda)
  union all select 13, 'Todas las categorías de los productos están en la lista del panel',
    not exists (select 1 from public.products p where btrim(coalesce(p.categoria, '')) <> ''
                and not exists (select 1 from public.categorias_tienda c where lower(c.nombre) = lower(btrim(p.categoria))))
  union all select 14, 'Sin descuentos, ofertas ni banners todavía (recién instalada)',
    (select count(*) from public.descuentos_producto) = 0 and (select count(*) from public.ofertas_flash) = 0
    and (select count(*) from public.promo_banners) = 0 and (select count(*) from public.ventas_descuentos) = 0
  union all select 15, 'La tienda sigue publicando el catálogo', (select count(*) from public.catalogo_tienda()) > 0
),
invariantes as (
  select regla, problemas from (
    with
    venta_vs_asignacion as (
      select s.id from public.sales s
      left join (select sale_id, sum(total) t, sum(costo) c, sum(comision) k, sum(ganancia) g, count(*) n,
                        bool_and(anulada) todas_anuladas, bool_or(anulada) alguna_anulada
                 from public.sale_allocations group by sale_id) a on a.sale_id = s.id
      where a.sale_id is null
         or round(a.t, 2) <> round(coalesce(s.total, 0), 2) or round(a.c, 2) <> round(coalesce(s.costo_total, 0), 2)
         or round(a.k, 2) <> round(coalesce(s.comision_total, 0), 2) or round(a.g, 2) <> round(coalesce(s.ganancia, 0), 2)
         or a.todas_anuladas <> a.alguna_anulada or a.todas_anuladas <> coalesce(s.anulada, false)),
    gasto_vs_partes as (
      select e.id from public.expenses e
      left join (select expense_id, sum(importe) t from public.expense_allocations group by expense_id) a on a.expense_id = e.id
      where a.expense_id is null or round(a.t, 2) <> round(coalesce(e.importe, 0), 2)),
    caja_v3_por_venta as (
      -- Ventas v3 vigentes: los movimientos de caja de cada cuenta = total - comisión de esa cuenta
      select sa.sale_id from public.sale_allocations sa
      join public.sales s on s.id = sa.sale_id and not coalesce(s.anulada, false)
      where sa.origen = 'v3' and round(sa.total - sa.comision, 2) <> round(coalesce((
        select sum(case when c.tipo = 'ingreso' then c.monto else -c.monto end) from public.cash_movements c
        where c.ref_id = sa.sale_id and c.account_id = sa.account_id), 0), 2)),
    caja_v3_anuladas as (
      -- Ventas y gastos v3 anulados: sus movimientos de caja tienen que sumar 0
      select s.id from public.sales s
      where coalesce(s.anulada, false) and exists (select 1 from public.sale_allocations a where a.sale_id = s.id and a.origen = 'v3')
        and round(coalesce((select sum(case when c.tipo = 'ingreso' then c.monto else -c.monto end)
                            from public.cash_movements c where c.ref_id = s.id), 0), 2) <> 0
      union all
      select e.id from public.expenses e
      where coalesce(e.anulada, false) and exists (select 1 from public.expense_allocations a where a.expense_id = e.id and a.origen = 'v3')
        and round(coalesce((select sum(case when c.tipo = 'ingreso' then c.monto else -c.monto end)
                            from public.cash_movements c where c.ref_id = e.id), 0), 2) <> 0),
    transferencias as (
      select t.id from public.account_transfers t
      where round(coalesce((select sum(case when c.tipo = 'ingreso' then c.monto else -c.monto end)
                            from public.cash_movements c where c.ref_id = t.id), 0), 2)
            <> case when t.anulada then 0
                    when t.tipo in ('liquidacion', 'reparto') then 0
                    when t.tipo = 'retiro' then -t.monto
                    when t.tipo = 'aporte' then t.monto
                    when t.to_account_id is not null then t.monto else -t.monto end)
    select 'I1 Cada venta = suma de sus asignaciones por cuenta' as regla, (select count(*) from venta_vs_asignacion) as problemas
    union all select 'I2 Cada gasto = suma de sus partes', (select count(*) from gasto_vs_partes)
    union all select 'I3 Caja de ventas v3 = total - comisión por cuenta', (select count(*) from caja_v3_por_venta)
    union all select 'I3b Operaciones v3 anuladas suman 0 en caja', (select count(*) from caja_v3_anuladas)
    union all select 'I3c Movimientos entre cuentas cuadran en caja', (select count(*) from transferencias)
    union all select 'I4 Matriz cuenta × custodio = saldo total de caja',
      (select case when round(coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0), 2) =
                        round(coalesce((select sum(s) from (select sum(case when tipo = 'ingreso' then monto else -monto end) s
                                                            from public.cash_movements group by account_id, holder_id) x), 0), 2)
                   then 0 else 1 end from public.cash_movements)
    union all select 'I5 Movimientos de caja sin cuenta o sin custodio',
      (select count(*) from public.cash_movements where account_id is null or holder_id is null)
    union all select 'I5b Productos sin dueño', (select count(*) from public.products where owner_account_id is null)
    union all select 'I5c Líneas de ventas v3 sin dueño registrado',
      (select count(*) from public.sales s, jsonb_array_elements(s.items::jsonb) e
       where exists (select 1 from public.sale_allocations a where a.sale_id = s.id and a.origen = 'v3')
         and coalesce(e->>'ownerAccountId', '') = '')
    union all select 'I6 Datos anteriores a la migración fuera de ELDOSTORE',
      (select count(*) from public.sale_allocations a join public.accounts c on c.id = a.account_id
       where a.origen = 'historico' and c.codigo <> 'eldostore')
      + (select count(*) from public.expense_allocations a join public.accounts c on c.id = a.account_id
         where a.origen = 'historico' and c.codigo <> 'eldostore')
    union all select 'I7 Exactamente un administrador, activo y con custodio Diego',
      (select case when count(*) = 1 and bool_and(u.activo) and bool_and(h.codigo = 'diego') then 0 else 1 end
       from public.app_users u join public.cash_holders h on h.id = u.holder_id where u.es_admin)
    union all select 'I8 Funciones v2 que todavía se ejecutan desde el navegador',
      (select count(*) from public.eldo_003_permisos_originales o
       where has_function_privilege('anon', o.firma::regprocedure, 'execute')
          or has_function_privilege('authenticated', o.firma::regprocedure, 'execute'))
    union all select 'I9 Tablas internas sin la restricción de usuarios habilitados',
      (select count(*) from unnest(array['products','clients','sales','orders','purchases','expenses','cash_movements','shipments','app_config']) t
       where to_regclass('public.' || t) is not null
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t and p.policyname = 'eldo003_alta_habilitados'))
  ) i
)
select n as nro, control, case when ok then 'OK' else 'FALLA' end as resultado from controles
union all
select 100 + row_number() over (order by regla), 'V003 · ' || regla, case when problemas = 0 then 'OK' else 'FALLA (' || problemas || ')' end
from invariantes
order by 1;
