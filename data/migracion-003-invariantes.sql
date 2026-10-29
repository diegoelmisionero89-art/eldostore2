-- =============================================================================
-- ELDOSTORE — Invariantes de la migración 003 (SOLO LECTURA)
-- Correr después de migrar y después de las pruebas. Cada fila es una regla:
-- "problemas" tiene que ser 0 en todas. Si no, compartir el resultado.
-- =============================================================================
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
order by 1;
