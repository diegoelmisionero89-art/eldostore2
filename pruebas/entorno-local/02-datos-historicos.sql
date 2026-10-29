-- =============================================================================
-- ENTORNO LOCAL DE PRUEBA — DATOS HISTÓRICOS FICTICIOS (anteriores a la 003)
-- Se cargan usando las funciones v2 simuladas, como lo haría el panel actual.
-- NUNCA correr en Supabase.
-- =============================================================================
do $$ begin
  if current_database() <> 'eldo_prueba_local' then
    raise exception 'Este script solo se ejecuta en la base local "eldo_prueba_local".';
  end if;
end $$;

insert into auth.users (id, email, last_sign_in_at) values
  ('00000000-0000-0000-0000-00000000d1e9', 'diego@prueba.local', now());

-- Sesión simulada del usuario actual (como hace Supabase con el token)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d1e9","role":"authenticated"}', false);

insert into clients (nombre, telefono) values ('Cliente Histórico', '3757000000');
insert into products (codigo, nombre, categoria, costo, precio, stock) values
  ('H01', 'Producto histórico 1', 'Electrónica', 5000, 10000, 20),
  ('H02', 'Producto histórico 2', 'Hogar', 8000, 15000, 10),
  ('H03', 'Producto histórico 3 <b>"especial"</b>', '', 1000, 2500, 5);

do $$
declare p1 uuid; p2 uuid; p3 uuid; s1 jsonb; s2 jsonb; s3 jsonb; c1 jsonb; o1 uuid; o2 uuid; g1 uuid;
begin
  select id into p1 from products where codigo = 'H01';
  select id into p2 from products where codigo = 'H02';
  select id into p3 from products where codigo = 'H03';
  -- Venta propia, venta por revendedor, una venta anulada y una corregida
  s1 := register_sale_v2(null, jsonb_build_array(jsonb_build_object('productoId', p1, 'cantidad', 2, 'precioVenta', 10000)), 'Efectivo', 'propia');
  s2 := register_sale_v2(null, jsonb_build_array(jsonb_build_object('productoId', p2, 'cantidad', 1, 'precioVenta', 15000, 'comisionPct', 10),
                                                 jsonb_build_object('productoId', p3, 'cantidad', 2, 'precioVenta', 2500, 'comisionPct', 5)), 'Transferencia', 'revendedor');
  s3 := register_sale_v2(null, jsonb_build_array(jsonb_build_object('productoId', p1, 'cantidad', 1, 'precioVenta', 10000)), 'Efectivo', 'propia');
  perform void_sale((s3->>'id')::uuid, 'Prueba histórica de anulación');
  perform correct_sale((s1->>'id')::uuid, 'Prueba histórica de corrección', null,
    jsonb_build_array(jsonb_build_object('productoId', p1, 'cantidad', 3, 'precioVenta', 10000)), 'Efectivo', 'propia');
  -- Compras (una anulada)
  perform register_purchase('Proveedor CDE', p2, 4, 8000, 'Efectivo', '');
  c1 := register_purchase('Proveedor CDE', p3, 2, 1000, 'Efectivo', '');
  perform void_purchase((c1->>'id')::uuid, 'Prueba histórica');
  -- Gasto cargado como lo hace el panel actual (2 inserts) y uno anulado
  insert into expenses (descripcion, categoria, importe, metodo_pago) values ('Flete histórico', 'Envíos', 7000, 'Efectivo') returning id into g1;
  insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('egreso', 'gasto', 7000, 'Flete histórico', g1);
  insert into expenses (descripcion, categoria, importe, metodo_pago) values ('Bolsas', 'Insumos', 1500, 'Efectivo') returning id into g1;
  insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('egreso', 'gasto', 1500, 'Bolsas', g1);
  perform void_expense(g1, 'Prueba histórica');
  -- Movimiento manual de caja
  insert into cash_movements (tipo, origen, monto, descripcion) values ('ingreso', 'otro', 50000, 'Saldo inicial histórico');
  -- Pedidos: uno convertido y uno pendiente con seña (la seña no toca la caja, como hoy)
  insert into orders (items, total, sena, saldo, estado) values
    (jsonb_build_array(jsonb_build_object('productoId', p2, 'cantidad', 1, 'precio', 15000)), 15000, 0, 15000, 'Confirmado') returning id into o1;
  perform convert_order_to_sale(o1, 'Efectivo');
  insert into orders (items, total, sena, saldo, estado) values
    (jsonb_build_array(jsonb_build_object('productoId', p1, 'cantidad', 1, 'precio', 10000)), 10000, 3000, 7000, 'Pendiente');
end $$;

select set_config('request.jwt.claims', '', false);
