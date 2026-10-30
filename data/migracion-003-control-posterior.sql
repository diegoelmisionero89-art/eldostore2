-- =============================================================================
-- ELDOSTORE V003 — Paso 5 (SOLO LECTURA): control después de migrar
-- No necesita la copia rápida del paso 3. No cambia nada en la base.
-- Cada fila tiene que decir OK. La última fila ("COMPARAR") muestra las filas por
-- tabla para compararlas con el resumen del respaldo de GitHub (paso 2), si lo hiciste.
-- =============================================================================
with
nuevas(t) as (values ('accounts'), ('cash_holders'), ('app_users'), ('sale_allocations'), ('expense_allocations'),
                     ('account_transfers'), ('stock_adjustments'), ('audit_log')),
internas(t) as (values ('products'), ('clients'), ('sales'), ('orders'), ('purchases'), ('expenses'),
                       ('cash_movements'), ('shipments'), ('app_config')),
v2(f) as (select firma from public.eldo_003_permisos_originales),
cat as (select * from public.catalogo_tienda()),
ventas as (
  select s.id, coalesce(s.total, 0) total, coalesce(s.anulada, false) anulada,
         (select count(*) from public.sale_allocations a where a.sale_id = s.id) n_asig,
         (select coalesce(sum(a.total), 0) from public.sale_allocations a where a.sale_id = s.id) t_asig
  from public.sales s)
select 1 as n, 'Estructura: las 8 tablas nuevas existen' as control,
       case when (select count(*) from nuevas where to_regclass('public.' || t) is not null) = 8
            then 'OK' else 'REVISAR: faltan ' || (select string_agg(t, ', ') from nuevas where to_regclass('public.' || t) is null) end as resultado
union all
select 2, 'Cuentas: ' || (select string_agg(nombre, ', ' order by nombre) from public.accounts),
       case when (select count(*) from public.accounts where codigo in ('eldostore', 'niko', 'ayelen')) = 3
             and (select count(*) from public.cash_holders where codigo in ('diego', 'niko', 'ayelen')) = 3
            then 'OK (3 cuentas y 3 personas)' else 'REVISAR' end
union all
select 3, 'Administrador: un solo usuario administrador (Diego), activo',
       case when (select count(*) from public.app_users where es_admin) = 1
             and exists (select 1 from public.app_users a join auth.users u on u.id = a.user_id
                         join public.cash_holders h on h.id = a.holder_id
                         where a.es_admin and a.activo and h.codigo = 'diego'
                           and lower(u.email) = 'diegoelmisionero89@gmail.com')
            then 'OK (usuarios habilitados en total: ' || (select count(*) from public.app_users where activo) || ')' else 'REVISAR' end
union all
select 4, 'Productos conservados: todos tienen dueño',
       case when (select count(*) from public.products) > 0 and (select count(*) from public.products where owner_account_id is null) = 0
            then 'OK (' || (select count(*) from public.products) || ' productos: '
                 || (select string_agg(x, ', ') from (select a.nombre || ' ' || count(*) x from public.products p
                     join public.accounts a on a.id = p.owner_account_id group by a.nombre order by a.nombre) z)
                 || '; ' || (select coalesce(sum(stock), 0) from public.products) || ' unidades en stock)'
            else 'REVISAR' end
union all
select 5, 'Ventas conservadas: cada venta tiene su asignación y los importes coinciden',
       case when (select count(*) from ventas where n_asig = 0 or round(t_asig, 2) <> round(total, 2)) = 0
            then 'OK (' || (select count(*) from ventas where not anulada) || ' vigentes, '
                 || (select count(*) from ventas where anulada) || ' anuladas; total vigente $'
                 || (select coalesce(sum(total), 0) from ventas where not anulada) || ')'
            else 'REVISAR: ' || (select count(*) from ventas where n_asig = 0 or round(t_asig, 2) <> round(total, 2)) || ' ventas no coinciden' end
union all
select 6, 'Historial: todas las ventas y gastos anteriores quedaron en ELDOSTORE',
       case when (select count(*) from public.sale_allocations a join public.accounts c on c.id = a.account_id
                  where a.origen = 'historico' and c.codigo <> 'eldostore') = 0
             and (select count(*) from public.expense_allocations a join public.accounts c on c.id = a.account_id
                  where a.origen = 'historico' and c.codigo <> 'eldostore') = 0
            then 'OK' else 'REVISAR' end
union all
select 7, 'Gastos: cada gasto tiene sus partes y suman el total',
       case when (select count(*) from public.expenses e where round(coalesce(e.importe, 0), 2) <>
                  round((select coalesce(sum(importe), 0) from public.expense_allocations a where a.expense_id = e.id), 2)) = 0
            then 'OK (' || (select count(*) from public.expenses) || ' gastos)' else 'REVISAR' end
union all
select 8, 'Caja: todos los movimientos tienen cuenta y persona',
       case when (select count(*) from public.cash_movements where account_id is null or holder_id is null) = 0
            then 'OK (' || (select count(*) from public.cash_movements) || ' movimientos; saldo total $'
                 || (select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) from public.cash_movements) || ')'
            else 'REVISAR' end
union all
select 9, 'Catálogo público: catalogo_tienda() responde y la tienda (anon) puede usarlo',
       case when (select count(*) from cat) > 0
             and has_function_privilege('anon', 'public.catalogo_tienda()', 'execute')
            then 'OK (' || (select count(*) from cat) || ' productos en la tienda, '
                 || (select count(*) from cat where not coalesce(disponible, true)) || ' sin stock)'
            else 'REVISAR' end
union all
select 10, 'Catálogo público: no muestra dueño ni costo',
       case when not exists (select 1 from jsonb_object_keys((select to_jsonb(c) from cat c limit 1)) k
                             where k in ('owner_account_id', 'costo'))
            then 'OK' else 'REVISAR' end
union all
select 11, 'Seguridad: tablas internas protegidas para usuarios no habilitados',
       case when (select count(*) from internas where to_regclass('public.' || t) is not null
                    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t
                                    and p.policyname = 'eldo003_alta_habilitados')) = 0
            then 'OK' else 'REVISAR' end
union all
select 12, 'Seguridad: las funciones anteriores ya no se llaman desde el navegador',
       case when (select count(*) from v2 where has_function_privilege('anon', f::regprocedure, 'execute')
                                            or has_function_privilege('authenticated', f::regprocedure, 'execute')) = 0
            then 'OK (' || (select count(*) from v2) || ' funciones cerradas)' else 'REVISAR' end
union all
select 13, 'Filas por tabla (para comparar con el respaldo de GitHub, si lo hiciste)',
       'COMPARAR: products ' || (select count(*) from public.products)
       || ', sales ' || (select count(*) from public.sales)
       || ', purchases ' || (select count(*) from public.purchases)
       || ', expenses ' || (select count(*) from public.expenses)
       || ', cash_movements ' || (select count(*) from public.cash_movements)
       || ', orders ' || (select count(*) from public.orders)
       || ', clients ' || (select count(*) from public.clients)
       || ', auth.users ' || (select count(*) from auth.users)
order by 1;
