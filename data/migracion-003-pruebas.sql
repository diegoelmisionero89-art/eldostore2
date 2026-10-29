-- =============================================================================
-- ELDOSTORE — Pruebas de la migración 003 (SOLO PARA EL PROYECTO DE PRUEBAS)
--
-- Crea datos de prueba (productos T003-*, usuarios t003-*@prueba.local) y ejecuta
-- los casos T1 a T16 de la auditoría y T18 (accesos y administrador). El resultado es una tabla: ok = true en todas.
--
-- Protección: solo corre si existe la tabla public.eldo_base_de_pruebas, que se crea
-- a mano en el proyecto de pruebas (ver instrucciones). En producción no existe.
-- Se puede correr varias veces: cada corrida usa códigos nuevos.
-- =============================================================================
do $guardia$ begin
  if to_regclass('public.eldo_base_de_pruebas') is null then
    raise exception 'Estas pruebas solo se corren en el proyecto de pruebas (falta la tabla eldo_base_de_pruebas).';
  end if;
  if to_regclass('public.accounts') is null then
    raise exception 'Primero aplicá la migración 003.';
  end if;
end $guardia$;

create table if not exists public.eldo_pruebas_resultados (
  n serial primary key, corrida text, prueba text, ok boolean, detalle text, fecha timestamptz default now());
revoke all on public.eldo_pruebas_resultados from anon, authenticated;

do $pruebas$
declare
  corrida text := to_char(clock_timestamp(), 'YYMMDDHH24MISSMS');
  u_diego uuid; u_niko uuid; u_ayelen uuid; u_extra uuid; u_admin uuid; u_nuevo uuid; e_admin text; e_niko text;
  a_eldo uuid := eldo_cuenta('eldostore'); a_niko uuid := eldo_cuenta('niko'); a_aye uuid := eldo_cuenta('ayelen');
  h_diego uuid := eldo_custodio('diego'); h_niko uuid := eldo_custodio('niko'); h_aye uuid := eldo_custodio('ayelen');
  pA uuid; pB uuid; pC uuid; pD uuid;
  r jsonb; s1 uuid; s2 uuid; s3 uuid; g1 uuid; o1 uuid; t1 uuid; c1 uuid; n1 bigint; n2 bigint; x numeric; y numeric;
  hist uuid; err text; ok boolean;
  pos0 jsonb; pos1 jsonb;

begin
  -- Helpers como funciones temporales de la sesión
  execute $f$ create or replace function pg_temp.ok(p_corrida text, p_prueba text, p_ok boolean, p_detalle text default '')
    returns void language sql as $b$ insert into public.eldo_pruebas_resultados (corrida, prueba, ok, detalle)
                                       values (p_corrida, p_prueba, coalesce(p_ok, false), p_detalle) $b$ $f$;
  execute $f$ create or replace function pg_temp.pos(p_acc uuid, p_hol uuid) returns numeric language sql as
    $b$ select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) from public.cash_movements
        where account_id = p_acc and holder_id = p_hol $b$ $f$;
  execute $f$ create or replace function pg_temp.saldo(p_acc uuid) returns numeric language sql as
    $b$ select coalesce(sum(case when tipo = 'ingreso' then monto else -monto end), 0) from public.cash_movements
        where account_id = p_acc $b$ $f$;
  -- Ejecuta una sentencia con el rol indicado (como el navegador) y devuelve 'ok' o el error.
  execute $f$ create or replace function pg_temp.intenta(p_rol text, p_sql text) returns text language plpgsql as
    $b$ begin execute format('set local role %I', p_rol); execute p_sql; execute 'reset role'; return 'ok';
        exception when others then return sqlerrm; end $b$ $f$;
  execute $f$ create or replace function pg_temp.cuenta(p_rol text, p_sql text) returns bigint language plpgsql as
    $b$ declare n bigint; begin execute format('set local role %I', p_rol); execute p_sql into n; execute 'reset role'; return n;
        exception when others then return -1; end $b$ $f$;
  execute $f$ create or replace function pg_temp.como(p_uid uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $b$ $f$;

  -- Usuarios de prueba (uno por persona) y uno NO habilitado
  insert into auth.users (id, email) select gen_random_uuid(), 't003-diego@prueba.local'
    where not exists (select 1 from auth.users where email = 't003-diego@prueba.local');
  insert into auth.users (id, email) select gen_random_uuid(), 't003-niko@prueba.local'
    where not exists (select 1 from auth.users where email = 't003-niko@prueba.local');
  insert into auth.users (id, email) select gen_random_uuid(), 't003-ayelen@prueba.local'
    where not exists (select 1 from auth.users where email = 't003-ayelen@prueba.local');
  insert into auth.users (id, email) select gen_random_uuid(), 't003-extra@prueba.local'
    where not exists (select 1 from auth.users where email = 't003-extra@prueba.local');
  select id into u_diego from auth.users where email = 't003-diego@prueba.local';
  select id into u_niko from auth.users where email = 't003-niko@prueba.local';
  select id into u_ayelen from auth.users where email = 't003-ayelen@prueba.local';
  select id into u_extra from auth.users where email = 't003-extra@prueba.local';
  insert into app_users (user_id, holder_id, nombre) values (u_diego, h_diego, 'Diego (prueba)'),
    (u_niko, h_niko, 'Niko (prueba)'), (u_ayelen, h_aye, 'Ayelen (prueba)')
  on conflict (user_id) do update set holder_id = excluded.holder_id, activo = true;
  delete from app_users where user_id = u_extra;
  -- Usuario nuevo para probar la autorización (empieza siempre sin habilitar)
  insert into auth.users (id, email) select gen_random_uuid(), 't003-nuevo@prueba.local'
    where not exists (select 1 from auth.users where email = 't003-nuevo@prueba.local');
  select id into u_nuevo from auth.users where email = 't003-nuevo@prueba.local';
  delete from app_users where user_id = u_nuevo;
  select a.user_id, u.email into u_admin, e_admin from app_users a join auth.users u on u.id = a.user_id where a.es_admin;
  e_niko := 't003-niko@prueba.local';

  -- Productos: A de ELDOSTORE, B de Niko, C de Ayelen, D de ELDOSTORE (poco stock)
  insert into products (codigo, nombre, categoria, costo, precio, stock, owner_account_id) values
    ('T003-A-' || corrida, 'Prueba Parlante', 'Audio', 5000, 10000, 10, a_eldo),
    ('T003-B-' || corrida, 'Prueba Smartwatch', 'Electrónica', 8000, 15000, 10, a_niko),
    ('T003-C-' || corrida, 'Prueba Planchita', 'Hogar', 6000, 12000, 5, a_aye),
    ('T003-D-' || corrida, 'Prueba Cable', 'Accesorios', 1000, 3000, 1, a_eldo);
  select id into pA from products where codigo = 'T003-A-' || corrida;
  select id into pB from products where codigo = 'T003-B-' || corrida;
  select id into pC from products where codigo = 'T003-C-' || corrida;
  select id into pD from products where codigo = 'T003-D-' || corrida;

  -- ---------------- T1 Venta mixta 1×A + 2×B, registra Ayelen, cobra Niko ----------------
  perform pg_temp.como(u_ayelen);
  x := pg_temp.pos(a_eldo, h_niko); y := pg_temp.pos(a_niko, h_niko);
  r := register_sale_v3(null, jsonb_build_array(jsonb_build_object('productoId', pA, 'cantidad', 1, 'precioVenta', 10000),
                                                jsonb_build_object('productoId', pB, 'cantidad', 2, 'precioVenta', 15000)),
                        'Efectivo', 'propia', h_niko);
  s1 := (r->>'id')::uuid;
  perform pg_temp.ok(corrida, 'T1 total de la venta = 40.000', (r->>'total')::numeric = 40000, r::text);
  perform pg_temp.ok(corrida, 'T1 asignación ELDOSTORE: 10.000 / costo 5.000 / ganancia 5.000',
    exists (select 1 from sale_allocations where sale_id = s1 and account_id = a_eldo and total = 10000 and costo = 5000 and ganancia = 5000));
  perform pg_temp.ok(corrida, 'T1 asignación Niko: 30.000 / costo 16.000 / ganancia 14.000',
    exists (select 1 from sale_allocations where sale_id = s1 and account_id = a_niko and total = 30000 and costo = 16000 and ganancia = 14000));
  perform pg_temp.ok(corrida, 'T1 caja: Niko tiene +10.000 de ELDOSTORE y +30.000 propios',
    pg_temp.pos(a_eldo, h_niko) - x = 10000 and pg_temp.pos(a_niko, h_niko) - y = 30000);
  perform pg_temp.ok(corrida, 'T1 stock A = 9 y B = 8',
    (select stock from products where id = pA) = 9 and (select stock from products where id = pB) = 8);
  perform pg_temp.ok(corrida, 'T1 queda registrado quién cobró y quién cargó',
    exists (select 1 from sales where id = s1 and holder_id = h_niko and creado_por = u_ayelen));
  perform pg_temp.ok(corrida, 'T1 cada línea guarda su dueño',
    (select count(*) from sales s, jsonb_array_elements(s.items::jsonb) e where s.id = s1 and e->>'ownerAccountId' is not null) = 2);

  -- ---------------- T2 Misma venta por revendedor al 10 % ----------------
  x := pg_temp.pos(a_eldo, h_niko); y := pg_temp.pos(a_niko, h_niko);
  r := register_sale_v3(null, jsonb_build_array(jsonb_build_object('productoId', pA, 'cantidad', 1, 'precioVenta', 10000, 'comisionPct', 10),
                                                jsonb_build_object('productoId', pB, 'cantidad', 2, 'precioVenta', 15000, 'comisionPct', 10)),
                        'Transferencia', 'revendedor', h_niko);
  s2 := (r->>'id')::uuid;
  perform pg_temp.ok(corrida, 'T2 comisión ELDOSTORE 1.000, ganancia 4.000',
    exists (select 1 from sale_allocations where sale_id = s2 and account_id = a_eldo and comision = 1000 and ganancia = 4000));
  perform pg_temp.ok(corrida, 'T2 comisión Niko 3.000, ganancia 11.000',
    exists (select 1 from sale_allocations where sale_id = s2 and account_id = a_niko and comision = 3000 and ganancia = 11000));
  perform pg_temp.ok(corrida, 'T2 caja neta en Niko: +9.000 de ELDOSTORE y +27.000 propios',
    pg_temp.pos(a_eldo, h_niko) - x = 9000 and pg_temp.pos(a_niko, h_niko) - y = 27000);

  -- ---------------- T3 Liquidación: Niko le entrega a Diego 10.000 de ELDOSTORE ----------------
  x := pg_temp.saldo(a_eldo);
  n1 := pg_temp.pos(a_eldo, h_niko); n2 := pg_temp.pos(a_eldo, h_diego);
  r := register_transfer('liquidacion', a_eldo, h_niko, a_eldo, h_diego, 10000, 'Entrega de cobros');
  t1 := (r->>'id')::uuid;
  perform pg_temp.ok(corrida, 'T3 saldo de ELDOSTORE sin cambio', pg_temp.saldo(a_eldo) = x);
  perform pg_temp.ok(corrida, 'T3 el dinero pasa de Niko a Diego',
    pg_temp.pos(a_eldo, h_niko) = n1 - 10000 and pg_temp.pos(a_eldo, h_diego) = n2 + 10000);
  begin
    perform register_transfer('liquidacion', a_eldo, h_niko, a_niko, h_diego, 100, 'mal');
    perform pg_temp.ok(corrida, 'T3b liquidación entre cuentas distintas se rechaza', false);
  exception when others then perform pg_temp.ok(corrida, 'T3b liquidación entre cuentas distintas se rechaza', true, sqlerrm); end;

  -- ---------------- T4 Gasto compartido 9.000 pagado por Diego ----------------
  perform pg_temp.como(u_diego);
  x := pg_temp.pos(a_eldo, h_diego); y := pg_temp.pos(a_niko, h_diego);
  r := register_expense_v3('Publicidad prueba', 'Publicidad', 9000, 'Transferencia', '',
         jsonb_build_array(jsonb_build_object('accountId', a_eldo, 'importe', 5000), jsonb_build_object('accountId', a_niko, 'importe', 2000),
                           jsonb_build_object('accountId', a_aye, 'importe', 2000)), h_diego);
  g1 := (r->>'id')::uuid;
  perform pg_temp.ok(corrida, 'T4 un solo gasto de 9.000 con 3 partes',
    (select importe from expenses where id = g1) = 9000 and (select count(*) from expense_allocations where expense_id = g1) = 3);
  perform pg_temp.ok(corrida, 'T4 un solo egreso total de 9.000 en caja (sin duplicar)',
    (select sum(monto) from cash_movements where ref_id = g1 and tipo = 'egreso') = 9000);
  perform pg_temp.ok(corrida, 'T4 ELDOSTORE −5.000 y Niko −2.000 adelantados por Diego',
    pg_temp.pos(a_eldo, h_diego) - x = -5000 and pg_temp.pos(a_niko, h_diego) - y = -2000);

  -- ---------------- T5 Gasto con partes que no suman, o cuenta repetida ----------------
  n1 := (select count(*) from expenses);
  begin
    perform register_expense_v3('Mal repartido', 'General', 9000, '', '',
      jsonb_build_array(jsonb_build_object('accountId', a_eldo, 'importe', 5000), jsonb_build_object('accountId', a_niko, 'importe', 2000),
                        jsonb_build_object('accountId', a_aye, 'importe', 1000)), h_diego);
    perform pg_temp.ok(corrida, 'T5 partes que no suman se rechazan', false);
  exception when others then perform pg_temp.ok(corrida, 'T5 partes que no suman se rechazan', true, sqlerrm); end;
  begin
    perform register_expense_v3('Cuenta repetida', 'General', 2000, '', '',
      jsonb_build_array(jsonb_build_object('accountId', a_eldo, 'importe', 1000), jsonb_build_object('accountId', a_eldo, 'importe', 1000)), h_diego);
    perform pg_temp.ok(corrida, 'T5b cuenta repetida en el reparto se rechaza', false);
  exception when others then perform pg_temp.ok(corrida, 'T5b cuenta repetida en el reparto se rechaza', true, sqlerrm); end;
  perform pg_temp.ok(corrida, 'T5c no quedó ningún gasto a medias', (select count(*) from expenses) = n1);

  -- ---------------- T6 Reparto extraordinario ELDOSTORE → Ayelen 20.000 ----------------
  x := pg_temp.saldo(a_eldo); y := pg_temp.saldo(a_aye);
  select ventas into n1 from resumen_cuentas() where codigo = 'eldostore';
  r := register_transfer('reparto', a_eldo, h_diego, a_aye, h_aye, 20000, 'Reparto extraordinario de prueba');
  perform pg_temp.ok(corrida, 'T6 saldos: ELDOSTORE −20.000, Ayelen +20.000',
    pg_temp.saldo(a_eldo) = x - 20000 and pg_temp.saldo(a_aye) = y + 20000);
  perform pg_temp.ok(corrida, 'T6 las ventas de ELDOSTORE no cambian',
    (select ventas from resumen_cuentas() where codigo = 'eldostore') = n1);

  -- ---------------- T7 Retiro personal de Niko 5.000 ----------------
  x := pg_temp.saldo(a_niko);
  select ganancia_neta into y from resumen_cuentas() where codigo = 'niko';
  r := register_transfer('retiro', a_niko, h_niko, null, null, 5000, 'Retiro personal de prueba');
  perform pg_temp.ok(corrida, 'T7 saldo de Niko −5.000', pg_temp.saldo(a_niko) = x - 5000);
  perform pg_temp.ok(corrida, 'T7 la ganancia de Niko no cambia', (select ganancia_neta from resumen_cuentas() where codigo = 'niko') = y);

  -- ---------------- T8 Compra 3×B (de Niko) pagada por Diego ----------------
  x := pg_temp.pos(a_niko, h_diego);
  r := register_purchase_v3('Proveedor prueba', pB, 3, 8000, 'Efectivo', '', h_diego);
  c1 := (r->>'id')::uuid;
  perform pg_temp.ok(corrida, 'T8 stock B +3 (6 → 9)', (select stock from products where id = pB) = 9);
  perform pg_temp.ok(corrida, 'T8 compra en la cuenta de Niko, pagada por Diego',
    exists (select 1 from purchases where id = c1 and account_id = a_niko and holder_id = h_diego and creado_por = u_diego));
  perform pg_temp.ok(corrida, 'T8 Niko le debe 24.000 a Diego (posición −24.000)', pg_temp.pos(a_niko, h_diego) - x = -24000);

  -- ---------------- T9 Anular la venta T1 (la anula Diego; devuelve Niko) ----------------
  x := pg_temp.pos(a_eldo, h_niko); y := pg_temp.pos(a_niko, h_niko);
  r := void_sale_v3(s1, 'Prueba de anulación');
  perform pg_temp.ok(corrida, 'T9 venta anulada por Diego',
    exists (select 1 from sales where id = s1 and anulada and anulado_por = u_diego));
  perform pg_temp.ok(corrida, 'T9 stock devuelto (A 8 → 9, B 9 → 11)',
    (select stock from products where id = pA) = 9 and (select stock from products where id = pB) = 11);
  perform pg_temp.ok(corrida, 'T9 caja revertida: −10.000 y −30.000 en Niko',
    pg_temp.pos(a_eldo, h_niko) - x = -10000 and pg_temp.pos(a_niko, h_niko) - y = -30000);
  perform pg_temp.ok(corrida, 'T9 asignaciones anuladas', not exists (select 1 from sale_allocations where sale_id = s1 and not anulada));
  begin
    perform void_sale_v3(s1, 'otra vez');
    perform pg_temp.ok(corrida, 'T9b anular dos veces se rechaza', false);
  exception when others then perform pg_temp.ok(corrida, 'T9b anular dos veces se rechaza', true, sqlerrm); end;

  -- ---------------- T10 Corrección después de cambiar el dueño de C ----------------
  r := register_sale_v3(null, jsonb_build_array(jsonb_build_object('productoId', pC, 'cantidad', 1, 'precioVenta', 12000)), 'Efectivo', 'propia', h_aye);
  s3 := (r->>'id')::uuid;
  update products set costo = 7000 where id = pC;  -- cambia el costo actual
  perform set_product_owner(pC, a_niko, 'Prueba de cambio de dueño');
  r := correct_sale_v3(s3, 'Eran 2 unidades', null,
         jsonb_build_array(jsonb_build_object('productoId', pC, 'cantidad', 2, 'precioVenta', 12000)), 'Efectivo', 'propia', null);
  perform pg_temp.ok(corrida, 'T10 la corrección conserva el dueño histórico (Ayelen)',
    exists (select 1 from sale_allocations where sale_id = (r->>'id')::uuid and account_id = a_aye and total = 24000));
  perform pg_temp.ok(corrida, 'T10 la corrección conserva el costo histórico (6.000 c/u)',
    exists (select 1 from sale_allocations where sale_id = (r->>'id')::uuid and costo = 12000));
  perform pg_temp.ok(corrida, 'T10 la venta nueva queda vinculada a la original',
    exists (select 1 from sales where id = (r->>'id')::uuid and corrige_a = s3) and exists (select 1 from sales where id = s3 and anulada));
  r := register_sale_v3(null, jsonb_build_array(jsonb_build_object('productoId', pC, 'cantidad', 1, 'precioVenta', 12000)), 'Efectivo', 'propia', h_niko);
  perform pg_temp.ok(corrida, 'T10b una venta nueva de C ya va al dueño nuevo (Niko)',
    exists (select 1 from sale_allocations where sale_id = (r->>'id')::uuid and account_id = a_niko));
  perform pg_temp.ok(corrida, 'T10c el cambio de dueño queda auditado',
    exists (select 1 from audit_log where accion = 'cambiar_dueno' and registro = pC and usuario = u_diego));

  -- ---------------- T11 Anular una compra cuyas unidades ya se vendieron ----------------
  r := register_purchase_v3('Proveedor prueba', pD, 2, 1000, 'Efectivo', '', h_diego);
  c1 := (r->>'id')::uuid;
  perform register_sale_v3(null, jsonb_build_array(jsonb_build_object('productoId', pD, 'cantidad', 3, 'precioVenta', 3000)), 'Efectivo', 'propia', h_diego);
  begin
    perform void_purchase_v3(c1, 'Prueba');
    perform pg_temp.ok(corrida, 'T11 no se anula una compra ya vendida', false);
  exception when others then perform pg_temp.ok(corrida, 'T11 no se anula una compra ya vendida', true, sqlerrm); end;
  begin
    perform register_sale_v3(null, jsonb_build_array(jsonb_build_object('productoId', pD, 'cantidad', 1, 'precioVenta', 3000)), 'Efectivo', 'propia', h_diego);
    perform pg_temp.ok(corrida, 'T11b venta sin stock se rechaza', false);
  exception when others then perform pg_temp.ok(corrida, 'T11b venta sin stock se rechaza', (select stock from products where id = pD) = 0, sqlerrm); end;

  -- ---------------- T12 Pedido mixto → venta (cobra Ayelen) ----------------
  insert into orders (items, total, sena, saldo, estado, metodo_pago) values
    (jsonb_build_array(jsonb_build_object('productoId', pA, 'cantidad', 1, 'precio', 10000),
                       jsonb_build_object('productoId', pB, 'cantidad', 1, 'precio', 15000)), 25000, 5000, 20000, 'Confirmado', 'Efectivo')
  returning id into o1;
  r := convert_order_to_sale_v3(o1, null, h_aye);
  perform pg_temp.ok(corrida, 'T12 pedido mixto convertido y repartido (10.000 / 15.000)',
    exists (select 1 from orders where id = o1 and venta_id = (r->>'id')::uuid)
    and exists (select 1 from sale_allocations where sale_id = (r->>'id')::uuid and account_id = a_eldo and total = 10000)
    and exists (select 1 from sale_allocations where sale_id = (r->>'id')::uuid and account_id = a_niko and total = 15000));
  perform pg_temp.ok(corrida, 'T12b el total entra una sola vez (25.000, sin sumar la seña aparte)',
    (select sum(monto) from cash_movements where ref_id = (r->>'id')::uuid and tipo = 'ingreso') = 25000);
  begin
    perform convert_order_to_sale_v3(o1, null, h_aye);
    perform pg_temp.ok(corrida, 'T12c no se convierte dos veces', false);
  exception when others then perform pg_temp.ok(corrida, 'T12c no se convierte dos veces', true, sqlerrm); end;

  -- ---------------- T13 Operaciones anteriores a la migración ----------------
  select s.id into hist from sales s join sale_allocations a on a.sale_id = s.id
  where a.origen = 'historico' and not coalesce(s.anulada, false) order by s.fecha limit 1;
  if hist is null then
    perform pg_temp.ok(corrida, 'T13 anular una venta histórica', true, 'No hay ventas históricas vigentes para probar');
  else
    x := pg_temp.saldo(a_eldo);
    r := correct_sale_v3(hist, 'Prueba sobre venta histórica',
      (select cliente_id from sales where id = hist),
      (select jsonb_agg(jsonb_build_object('productoId', e->>'productoId', 'cantidad', (e->>'cantidad')::numeric,
                                           'precioVenta', (e->>'precioVenta')::numeric, 'comisionPct', e->'comisionPct'))
       from sales s, jsonb_array_elements(s.items::jsonb) e where s.id = hist),
      (select metodo_pago from sales where id = hist), (select modalidad from sales where id = hist), null);
    perform pg_temp.ok(corrida, 'T13 corregir una venta histórica sin cambios deja el saldo de ELDOSTORE igual',
      pg_temp.saldo(a_eldo) = x, 'antes ' || x || ', después ' || pg_temp.saldo(a_eldo));
    perform pg_temp.ok(corrida, 'T13b la histórica queda anulada y la nueva en ELDOSTORE',
      exists (select 1 from sales where id = hist and anulada and anulado_por = u_diego)
      and not exists (select 1 from sale_allocations where sale_id = (r->>'id')::uuid and account_id <> a_eldo));
  end if;

  -- ---------------- T14 Permisos ----------------
  perform pg_temp.como(u_extra);
  begin
    perform register_sale_v3(null, jsonb_build_array(jsonb_build_object('productoId', pA, 'cantidad', 1, 'precioVenta', 1)), '', 'propia', null);
    perform pg_temp.ok(corrida, 'T14 un usuario con sesión pero no habilitado no puede vender', false);
  exception when others then perform pg_temp.ok(corrida, 'T14 un usuario con sesión pero no habilitado no puede vender', true, sqlerrm); end;
  ok := false;
  begin
    execute 'set local role anon';
    begin
      perform register_sale_v3(null, '[]'::jsonb, '', 'propia', null);
    exception when insufficient_privilege then ok := true;
    end;
    execute 'reset role';
  exception when others then execute 'reset role'; err := sqlerrm;
  end;
  perform pg_temp.ok(corrida, 'T14b anon no puede ejecutar funciones v3', ok, coalesce(err, ''));
  ok := false; err := null;
  begin
    execute 'set local role anon';
    begin
      perform 1 from public.accounts limit 1;
    exception when insufficient_privilege then ok := true;
    end;
    execute 'reset role';
  exception when others then execute 'reset role'; err := sqlerrm;
  end;
  perform pg_temp.ok(corrida, 'T14c anon no puede leer las cuentas', ok, coalesce(err, ''));
  begin
    execute 'set local role authenticated';
    n1 := (select count(*) from public.accounts);
    execute 'reset role';
  exception when others then execute 'reset role'; n1 := -1;
  end;
  perform pg_temp.ok(corrida, 'T14d un usuario no habilitado no ve las cuentas', n1 = 0, 'filas visibles: ' || n1);
  perform pg_temp.como(u_niko);
  begin
    execute 'set local role authenticated';
    n1 := (select count(*) from public.accounts);
    execute 'reset role';
  exception when others then execute 'reset role'; n1 := -1;
  end;
  perform pg_temp.ok(corrida, 'T14e un usuario habilitado ve las tres cuentas', n1 = 3, 'filas visibles: ' || n1);

  -- ---------------- T15 Ajuste de stock con registro ----------------
  perform adjust_stock_v3(pA, -1, 'Unidad dañada (prueba)');
  perform pg_temp.ok(corrida, 'T15 ajuste de stock registrado con motivo y usuario',
    exists (select 1 from stock_adjustments where product_id = pA and delta = -1 and creado_por = u_niko));

  -- ---------------- T16 Tienda pública ----------------
  perform pg_temp.ok(corrida, 'T16 catalogo_tienda() sigue respondiendo y no expone dueño ni costo',
    (select count(*) from catalogo_tienda()) > 0
    and not exists (select 1 from jsonb_object_keys((select to_jsonb(c) from catalogo_tienda() c limit 1)) k
                    where k in ('owner_account_id', 'costo', 'stock')));

  -- ---------------- T18 Accesos: solo el administrador habilita usuarios ----------------
  perform pg_temp.ok(corrida, 'T18a hay un solo administrador, activo y con custodio Diego',
    (select count(*) from app_users where es_admin) = 1
    and exists (select 1 from app_users where es_admin and activo and holder_id = h_diego));
  perform pg_temp.ok(corrida, 'T18b los usuarios de prueba no son administradores',
    not exists (select 1 from app_users where es_admin and user_id in (u_diego, u_niko, u_ayelen)));

  -- Usuario con sesión pero sin autorizar
  perform pg_temp.como(u_nuevo);
  err := pg_temp.intenta('authenticated', format('select public.register_transfer(%L, null, null, %L::uuid, %L::uuid, 1, %L)', 'aporte', a_eldo, h_diego, 'x'));
  perform pg_temp.ok(corrida, 'T18c un usuario sin autorizar no puede operar (funciones v3)', err <> 'ok', err);
  err := pg_temp.intenta('authenticated', format('select public.vincular_usuario(%L, %L::uuid, true)', 't003-nuevo@prueba.local', h_diego));
  perform pg_temp.ok(corrida, 'T18d un usuario sin autorizar no puede habilitarse a sí mismo', err <> 'ok', err);
  err := pg_temp.intenta('authenticated', $q$insert into public.cash_movements (tipo, origen, monto, descripcion) values ('ingreso', 'otro', 1, 'intrusión')$q$);
  perform pg_temp.ok(corrida, 'T18e un usuario sin autorizar no puede escribir directo en la caja', err <> 'ok', err);
  err := pg_temp.intenta('authenticated', $q$insert into public.clients (nombre) values ('intrusión')$q$);
  perform pg_temp.ok(corrida, 'T18f un usuario sin autorizar no puede cargar clientes', err <> 'ok', err);
  err := pg_temp.intenta('authenticated', format('update public.products set precio = 1 where id = %L', pA));
  perform pg_temp.ok(corrida, 'T18g un usuario sin autorizar no puede cambiar productos',
    (select precio from products where id = pA) = 10000, err);
  perform pg_temp.ok(corrida, 'T18h un usuario sin autorizar no ve ventas, gastos ni caja',
    pg_temp.cuenta('authenticated', 'select count(*) from public.sales') = 0
    and pg_temp.cuenta('authenticated', 'select count(*) from public.expenses') = 0
    and pg_temp.cuenta('authenticated', 'select count(*) from public.cash_movements') = 0);
  err := pg_temp.intenta('authenticated', format('select public.void_sale(%L::uuid, %L)', s1, 'intrusión'));
  perform pg_temp.ok(corrida, 'T18i las funciones v2 ya no se pueden llamar directo desde el navegador',
    err <> 'ok' and not exists (select 1 from sales where id = s1 and motivo_anulacion = 'intrusión'), err);
  perform pg_temp.ok(corrida, 'T18j la tienda pública sigue leyendo productos (anon y con sesión)',
    pg_temp.cuenta('anon', 'select count(*) from public.catalogo_tienda()') > 0
    and pg_temp.cuenta('authenticated', 'select count(*) from public.catalogo_tienda()') > 0);

  -- Usuario habilitado que NO es administrador (Niko)
  perform pg_temp.como(u_niko);
  err := pg_temp.intenta('authenticated', format('select public.vincular_usuario(%L, %L::uuid, true)', 't003-nuevo@prueba.local', h_aye));
  perform pg_temp.ok(corrida, 'T18k un usuario habilitado no administrador no puede habilitar a otro',
    err <> 'ok' and not exists (select 1 from app_users where user_id = u_nuevo), err);
  err := pg_temp.intenta('authenticated', format('select public.vincular_usuario(%L, %L::uuid, false)', e_admin, h_niko));
  perform pg_temp.ok(corrida, 'T18l un usuario no administrador no puede desactivar al administrador',
    err <> 'ok' and exists (select 1 from app_users where user_id = u_admin and activo and holder_id = h_diego), err);
  err := pg_temp.intenta('authenticated', format('select public.vincular_usuario(%L, %L::uuid, true)', e_niko, h_diego));
  perform pg_temp.ok(corrida, 'T18m un usuario no administrador no puede cambiar su propio custodio',
    err <> 'ok' and exists (select 1 from app_users where user_id = u_niko and holder_id = h_niko), err);
  err := pg_temp.intenta('authenticated', format('update public.app_users set es_admin = true where user_id = %L', u_niko));
  perform pg_temp.ok(corrida, 'T18n nadie puede darse permisos de administrador editando la tabla',
    err <> 'ok' and not exists (select 1 from app_users where user_id = u_niko and es_admin), err);
  err := pg_temp.intenta('authenticated', $q$insert into public.clients (nombre) values ('cliente T18 (prueba)')$q$);
  perform pg_temp.ok(corrida, 'T18o un usuario habilitado sigue usando el panel normalmente', err = 'ok', err);
  delete from clients where nombre = 'cliente T18 (prueba)';
  perform pg_temp.ok(corrida, 'T18p funciones internas y v2 no ejecutables desde el navegador',
    not has_function_privilege('authenticated', 'public._eldo3_crear_venta(uuid, jsonb, text, text, uuid, uuid, uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.eldo_set_ctx(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.eldo_auditar(text, text, uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.eldo_es_admin()', 'execute')
    and not has_function_privilege('anon', 'public.vincular_usuario(text, uuid, boolean)', 'execute')
    and not exists (select 1 from public.eldo_003_permisos_originales o
                    where has_function_privilege('authenticated', o.firma::regprocedure, 'execute')
                       or has_function_privilege('anon', o.firma::regprocedure, 'execute')));

  -- El administrador autoriza, cambia y desactiva
  perform pg_temp.como(u_admin);
  err := pg_temp.intenta('authenticated', format('select public.vincular_usuario(%L, %L::uuid, true)', 't003-nuevo@prueba.local', h_aye));
  perform pg_temp.ok(corrida, 'T18q el administrador habilita a un usuario nuevo (sin permisos de administrador)',
    err = 'ok' and exists (select 1 from app_users where user_id = u_nuevo and activo and holder_id = h_aye and not es_admin), err);
  perform pg_temp.como(u_nuevo);
  perform pg_temp.ok(corrida, 'T18r después de autorizado, el usuario entra y ve las cuentas',
    pg_temp.cuenta('authenticated', 'select count(*) from public.accounts') = 3, '');
  perform pg_temp.como(u_admin);
  err := pg_temp.intenta('authenticated', format('select public.vincular_usuario(%L, %L::uuid, true)', 't003-nuevo@prueba.local', h_niko));
  perform pg_temp.ok(corrida, 'T18s el administrador cambia el custodio de otro usuario',
    err = 'ok' and exists (select 1 from app_users where user_id = u_nuevo and holder_id = h_niko), err);
  err := pg_temp.intenta('authenticated', format('select public.vincular_usuario(%L, %L::uuid, false)', 't003-nuevo@prueba.local', h_niko));
  perform pg_temp.como(u_nuevo);
  perform pg_temp.ok(corrida, 'T18t desactivado, el usuario ya no ve ni opera',
    err = 'ok' and pg_temp.cuenta('authenticated', 'select count(*) from public.accounts') = 0
    and pg_temp.intenta('authenticated', format('select public.register_transfer(%L, null, null, %L::uuid, %L::uuid, 1, %L)', 'aporte', a_eldo, h_diego, 'x')) <> 'ok', err);
  perform pg_temp.como(u_admin);
  err := pg_temp.intenta('authenticated', format('select public.vincular_usuario(%L, %L::uuid, false)', e_admin, h_diego));
  perform pg_temp.ok(corrida, 'T18u el administrador no puede desactivarse a sí mismo desde el panel',
    err <> 'ok' and exists (select 1 from app_users where user_id = u_admin and activo), err);
  perform pg_temp.ok(corrida, 'T18v cada cambio de acceso queda en la auditoría',
    (select count(*) from audit_log where accion = 'vincular_usuario' and registro = u_nuevo) >= 3);

  perform set_config('request.jwt.claims', '', true);
end
$pruebas$;

-- Resultado de la última corrida (ok = true en todas)
select prueba, ok, detalle from public.eldo_pruebas_resultados
where corrida = (select corrida from public.eldo_pruebas_resultados order by n desc limit 1)
order by n;
