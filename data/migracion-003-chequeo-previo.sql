-- =============================================================================
-- ELDOSTORE — Chequeo previo de la migración 003 (SOLO LECTURA)
-- Correr en la base donde se va a migrar, ANTES de la migración. No cambia nada.
-- Cada fila dice si un supuesto de la migración se cumple ("OK") o no.
-- Si alguna fila dice "REVISAR", no migrar: compartir el resultado.
-- (La migración repite estas verificaciones y se detiene sola si algo falla.)
-- =============================================================================
with columnas_requeridas(tabla, columna) as (values
  ('products','id'),('products','codigo'),('products','nombre'),('products','categoria'),('products','costo'),
  ('products','precio'),('products','stock'),('products','activo'),
  ('sales','id'),('sales','fecha'),('sales','cliente_id'),('sales','items'),('sales','total'),('sales','costo_total'),
  ('sales','ganancia'),('sales','metodo_pago'),('sales','pedido_id'),('sales','modalidad'),('sales','comision_total'),
  ('sales','anulada'),('sales','anulada_el'),('sales','motivo_anulacion'),('sales','corrige_a'),
  ('purchases','id'),('purchases','fecha'),('purchases','producto_id'),('purchases','cantidad'),('purchases','costo_unit'),
  ('purchases','total'),('purchases','anulada'),('purchases','corrige_a'),
  ('expenses','id'),('expenses','fecha'),('expenses','descripcion'),('expenses','categoria'),('expenses','importe'),
  ('expenses','metodo_pago'),('expenses','notas'),('expenses','anulada'),('expenses','anulada_el'),
  ('expenses','motivo_anulacion'),('expenses','corrige_a'),
  ('cash_movements','id'),('cash_movements','fecha'),('cash_movements','tipo'),('cash_movements','origen'),
  ('cash_movements','monto'),('cash_movements','descripcion'),('cash_movements','ref_id'),
  ('orders','id'),('orders','cliente_id'),('orders','items'),('orders','estado'),('orders','venta_id'),('orders','metodo_pago'),
  ('clients','id')),
funciones_requeridas(nombre, args) as (values
  ('void_sale', array['p_sale_id','p_motivo']),
  ('register_purchase', array['p_proveedor','p_producto_id','p_cantidad','p_costo_unit','p_metodo_pago','p_notas']),
  ('void_purchase', array['p_purchase_id','p_motivo']),
  ('void_expense', array['p_expense_id','p_motivo']))
select '1. Columna ' || r.tabla || '.' || r.columna as verificacion,
       case when c.column_name is null then 'REVISAR: no existe' else 'OK (' || c.data_type || ')' end as resultado
from columnas_requeridas r
left join information_schema.columns c on c.table_schema = 'public' and c.table_name = r.tabla and c.column_name = r.columna
union all
select '2. Función ' || f.nombre || '(' || array_to_string(f.args, ', ') || ')',
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = f.nombre
                           and p.proargnames[1:array_length(f.args, 1)] = f.args)
            then 'OK (devuelve ' || (select string_agg(distinct format_type(p.prorettype, null), ', ')
                                    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                    where n.nspname = 'public' and p.proname = f.nombre) || ')'
            else 'REVISAR: no existe con esos parámetros' end
from funciones_requeridas f
union all
select '3. Restricciones CHECK en ' || conrelid::regclass::text,
       'REVISAR si limita origen/tipo: ' || pg_get_constraintdef(oid)
from pg_constraint
where contype = 'c' and conrelid in ('public.cash_movements'::regclass, 'public.sales'::regclass, 'public.expenses'::regclass)
union all
select '4. Triggers en ' || event_object_table, 'REVISAR: ' || trigger_name || ' (' || event_manipulation || ')'
from information_schema.triggers
where trigger_schema = 'public' and event_object_table in ('sales','purchases','expenses','cash_movements','products','orders')
union all
select '5. Migración 003 ya aplicada',
       case when to_regclass('public.accounts') is null then 'OK (no aplicada)' else 'REVISAR: ya existe la tabla accounts' end
union all
select '6. Usuarios de Auth que quedarán vinculados a Diego', (select count(*)::text from auth.users)
union all
select '7. Productos con stock negativo (no bloquean, pero conviene revisar)', (select count(*)::text from public.products where stock < 0)
order by 1;
