-- =============================================================================
-- ENTORNO LOCAL DE PRUEBA — FUNCIONES v2 SIMULADAS. NO SON LAS REALES.
--
-- Reproducen el comportamiento que describe el README de la actualización 002
-- (ventas, compras, gastos, anulaciones y correcciones), para poder probar que la
-- migración 003 convive con ellas. Las reales viven solo en Supabase y la
-- migración 003 NO las modifica.
--
-- Se usa CREATE FUNCTION (sin OR REPLACE): si por error se corriera sobre una base
-- que ya tiene las funciones reales, falla en lugar de reemplazarlas.
-- NUNCA correr en Supabase.
-- =============================================================================
do $$ begin
  if current_database() <> 'eldo_prueba_local' then
    raise exception 'Este script solo se ejecuta en la base local "eldo_prueba_local".';
  end if;
end $$;

create function catalogo_tienda()
returns table (id uuid, codigo text, nombre text, categoria text, precio numeric, foto text, disponible boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.codigo, p.nombre, p.categoria, p.precio, p.foto, (p.stock > 0)
  from products p where coalesce(p.activo, true) order by p.nombre
$$;

-- Registro interno de venta (simulado). p_costos: {productoId: costoUnit} para correcciones.
create function _eldo_register_sale(p_cliente_id uuid, p_items jsonb, p_metodo_pago text, p_modalidad text,
                                    p_pedido_id uuid, p_corrige_a uuid, p_costos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; pr products%rowtype; lineas jsonb := '[]'; v_total numeric := 0; v_costo numeric := 0;
        v_com numeric := 0; sub numeric; cos numeric; com numeric; pct numeric; cu numeric; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  if p_modalidad not in ('propia', 'revendedor') then raise exception 'Modalidad inválida'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'productoId')::uuid for update;
    if not found then raise exception 'Producto inexistente'; end if;
    if pr.stock < (it->>'cantidad')::int then raise exception 'Stock insuficiente de %', pr.nombre; end if;
    update products set stock = stock - (it->>'cantidad')::int where id = pr.id;
    cu := coalesce((p_costos->>(pr.id::text))::numeric, pr.costo);
    pct := case when p_modalidad = 'revendedor' then coalesce((it->>'comisionPct')::numeric, 0) else 0 end;
    sub := round((it->>'cantidad')::numeric * (it->>'precioVenta')::numeric, 2);
    cos := round((it->>'cantidad')::numeric * cu, 2);
    com := round(sub * pct / 100, 2);
    lineas := lineas || jsonb_build_array(jsonb_build_object('productoId', pr.id, 'nombre', pr.nombre, 'cantidad', (it->>'cantidad')::int,
      'precioVenta', (it->>'precioVenta')::numeric, 'costoUnit', cu) ||
      case when p_modalidad = 'revendedor' then jsonb_build_object('comisionPct', pct) else '{}'::jsonb end);
    v_total := v_total + sub; v_costo := v_costo + cos; v_com := v_com + com;
  end loop;
  insert into sales (cliente_id, items, total, costo_total, ganancia, metodo_pago, pedido_id, modalidad, comision_total, corrige_a)
  values (p_cliente_id, lineas, v_total, v_costo, v_total - v_costo - v_com, coalesce(p_metodo_pago, ''), p_pedido_id,
          p_modalidad, v_com, p_corrige_a)
  returning id into v_id;
  insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('ingreso', 'venta', v_total, 'Venta', v_id);
  if v_com > 0 then
    insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('egreso', 'comision_revendedor', v_com, 'Comisión', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'total', v_total);
end $$;

create function register_sale_v2(p_cliente_id uuid, p_items jsonb, p_metodo_pago text, p_modalidad text)
returns jsonb language sql security definer set search_path = public as $$
  select _eldo_register_sale(p_cliente_id, p_items, p_metodo_pago, p_modalidad, null, null, '{}'::jsonb)
$$;

create function void_sale(p_sale_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v sales%rowtype; it jsonb; faltan text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  select * into v from sales where id = p_sale_id for update;
  if not found or v.anulada then raise exception 'Venta inexistente o ya anulada'; end if;
  for it in select * from jsonb_array_elements(v.items) loop
    update products set stock = stock + (it->>'cantidad')::int where id = (it->>'productoId')::uuid;
    if not found then faltan := faltan || (it->>'nombre'); end if;
  end loop;
  insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('egreso', 'venta', v.total, 'Anulación de venta', v.id);
  if v.comision_total > 0 then
    insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('ingreso', 'comision_revendedor', v.comision_total, 'Anulación de comisión', v.id);
  end if;
  update sales set anulada = true, anulada_el = now(), motivo_anulacion = p_motivo where id = v.id;
  update orders set estado = 'Pendiente', venta_id = null where venta_id = v.id;
  return jsonb_build_object('productosNoEncontrados', to_jsonb(faltan));
end $$;

create function correct_sale(p_sale_id uuid, p_motivo text, p_cliente_id uuid, p_items jsonb, p_metodo_pago text, p_modalidad text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare costos jsonb; v sales%rowtype;
begin
  select * into v from sales where id = p_sale_id;
  select coalesce(jsonb_object_agg(e->>'productoId', (e->>'costoUnit')::numeric), '{}') into costos from jsonb_array_elements(v.items) e;
  perform void_sale(p_sale_id, p_motivo);
  return _eldo_register_sale(p_cliente_id, p_items, p_metodo_pago, p_modalidad, v.pedido_id, p_sale_id, costos);
end $$;

create function convert_order_to_sale(p_order_id uuid, p_metodo_pago text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; items jsonb; r jsonb;
begin
  select * into o from orders where id = p_order_id for update;
  if o.venta_id is not null then raise exception 'El pedido ya fue convertido'; end if;
  select jsonb_agg(jsonb_build_object('productoId', e->>'productoId', 'cantidad', (e->>'cantidad')::int, 'precioVenta', (e->>'precio')::numeric))
    into items from jsonb_array_elements(o.items) e;
  r := _eldo_register_sale(o.cliente_id, items, coalesce(p_metodo_pago, o.metodo_pago), 'propia', o.id, null, '{}'::jsonb);
  update orders set venta_id = (r->>'id')::uuid where id = o.id;
  return r;
end $$;

create function register_purchase(p_proveedor text, p_producto_id uuid, p_cantidad int, p_costo_unit numeric, p_metodo_pago text, p_notas text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sesión requerida'; end if;
  insert into purchases (proveedor, producto_id, cantidad, costo_unit, total, metodo_pago, notas)
  values (p_proveedor, p_producto_id, p_cantidad, p_costo_unit, p_cantidad * p_costo_unit, p_metodo_pago, p_notas) returning id into v_id;
  update products set stock = stock + p_cantidad, costo = p_costo_unit where id = p_producto_id;
  insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('egreso', 'compra', p_cantidad * p_costo_unit, 'Compra', v_id);
  return jsonb_build_object('id', v_id);
end $$;

create function void_purchase(p_purchase_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c purchases%rowtype; st int;
begin
  select * into c from purchases where id = p_purchase_id for update;
  if not found or c.anulada then raise exception 'Compra inexistente o ya anulada'; end if;
  select stock into st from products where id = c.producto_id for update;
  if st < c.cantidad then raise exception 'Las unidades de esta compra ya se vendieron: usá Corregir'; end if;
  update products set stock = stock - c.cantidad where id = c.producto_id;
  insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('ingreso', 'compra', c.total, 'Anulación de compra', c.id);
  update purchases set anulada = true, anulada_el = now(), motivo_anulacion = p_motivo where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

create function correct_purchase(p_purchase_id uuid, p_motivo text, p_proveedor text, p_producto_id uuid, p_cantidad int,
                                 p_costo_unit numeric, p_metodo_pago text, p_notas text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform void_purchase(p_purchase_id, p_motivo);
  r := register_purchase(p_proveedor, p_producto_id, p_cantidad, p_costo_unit, p_metodo_pago, p_notas);
  update purchases set corrige_a = p_purchase_id where id = (r->>'id')::uuid;
  return r;
end $$;

create function void_expense(p_expense_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g expenses%rowtype;
begin
  select * into g from expenses where id = p_expense_id for update;
  if not found or g.anulada then raise exception 'Gasto inexistente o ya anulado'; end if;
  insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('ingreso', 'gasto', g.importe, 'Anulación de gasto', g.id);
  update expenses set anulada = true, anulada_el = now(), motivo_anulacion = p_motivo where id = g.id;
  return jsonb_build_object('ok', true);
end $$;

create function correct_expense(p_expense_id uuid, p_motivo text, p_descripcion text, p_categoria text, p_importe numeric,
                                p_metodo_pago text, p_notas text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform void_expense(p_expense_id, p_motivo);
  insert into expenses (descripcion, categoria, importe, metodo_pago, notas, corrige_a)
  values (p_descripcion, p_categoria, p_importe, p_metodo_pago, p_notas, p_expense_id) returning id into v_id;
  insert into cash_movements (tipo, origen, monto, descripcion, ref_id) values ('egreso', 'gasto', p_importe, p_descripcion, v_id);
  return jsonb_build_object('id', v_id);
end $$;

-- Permisos como describe el README: las funciones viejas, ejecutables también por anon.
revoke all on function _eldo_register_sale(uuid, jsonb, text, text, uuid, uuid, jsonb) from public;
grant execute on function catalogo_tienda() to anon, authenticated;
