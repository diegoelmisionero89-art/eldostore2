-- =============================================================================
-- ELDOSTORE — Pruebas de la migración 005 (SOLO base de pruebas)
-- Requiere la tabla public.eldo_base_de_pruebas (no existe en producción).
-- Resultado: tabla con ok = true en todas.
-- =============================================================================
do $g$ begin
  if to_regclass('public.eldo_base_de_pruebas') is null then
    raise exception 'Estas pruebas solo se corren en una base de pruebas (falta eldo_base_de_pruebas).';
  end if;
end $g$;
create table if not exists public.eldo_pruebas_005 (n serial primary key, prueba text, ok boolean, detalle text);
truncate public.eldo_pruebas_005;

do $p$
declare
  u_admin uuid; u_otro uuid; p1 uuid; p2 uuid; err text; r jsonb; v jsonb; c_aud uuid; c_acc uuid; b_ids uuid[] := '{}';
  hab numeric; antes text; despues text; s1 uuid; f1 uuid; i int;
begin
  execute $f$ create or replace function pg_temp.ok(t text, c boolean, d text default '') returns void language sql as
    $b$ insert into public.eldo_pruebas_005 (prueba, ok, detalle) values (t, coalesce(c, false), d) $b$ $f$;
  execute $f$ create or replace function pg_temp.como(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $b$ $f$;
  execute $f$ create or replace function pg_temp.intenta(rol text, q text) returns text language plpgsql as
    $b$ begin execute format('set local role %I', rol); execute q; execute 'reset role'; return 'ok';
        exception when others then return sqlerrm; end $b$ $f$;
  execute $f$ create or replace function pg_temp.lee(rol text, q text) returns jsonb language plpgsql as
    $b$ declare x jsonb; begin execute format('set local role %I', rol); execute q into x; execute 'reset role'; return x;
        exception when others then return jsonb_build_object('error', sqlerrm); end $b$ $f$;

  select user_id into u_admin from app_users where es_admin;
  select user_id into u_otro from app_users where not es_admin and activo limit 1;
  select string_agg(codigo || ':' || precio || ':' || costo || ':' || stock, ',' order by codigo) into antes from products;
  insert into products (codigo, nombre, categoria, costo, precio, stock) values
    ('T005-A', 'Prueba 005 A', 'Audio', 10000, 33475, 10), ('T005-B', 'Prueba 005 B', 'Accesorios', 500, 1999, 10);
  select id into p1 from products where codigo = 'T005-A';
  select id into p2 from products where codigo = 'T005-B';

  -- Permisos
  perform pg_temp.como(u_otro);
  err := pg_temp.intenta('authenticated', format('select guardar_banner(null, %L, %L, %L, %L, %L, true)', 'principal', 'https://x.test/b.jpg', 'b', 'ninguno', ''));
  perform pg_temp.ok('P1 un usuario habilitado que no es administrador no puede crear banners', err <> 'ok', err);
  err := pg_temp.intenta('authenticated', format('select poner_descuento(%L::uuid, 20, null)', p1));
  perform pg_temp.ok('P2 ni poner descuentos', err <> 'ok', err);
  err := pg_temp.intenta('authenticated', 'insert into promo_banners (ubicacion, imagen_url) values (''principal'', ''https://x.test/z.jpg'')');
  perform pg_temp.ok('P3 ni escribir directo en las tablas', err <> 'ok', err);
  perform pg_temp.ok('P4 anon no lee las tablas', pg_temp.intenta('anon', 'select 1 from descuentos_producto') <> 'ok');
  perform pg_temp.ok('P5 anon no usa funciones del panel', pg_temp.intenta('anon', 'select promociones_panel()') <> 'ok');

  -- Banners (administrador)
  perform pg_temp.como(u_admin);
  for i in 1..7 loop
    r := pg_temp.lee('authenticated', format('select guardar_banner(null, %L, %L, %L, %L, %L, true)', 'principal',
         'https://x.test/b' || i || '.jpg', 'Banner ' || i, 'categoria', 'Audio'));
    b_ids := b_ids || (r->>'id')::uuid;
  end loop;
  err := pg_temp.intenta('authenticated', format('select guardar_banner(null, %L, %L, %L, %L, %L, true)', 'principal', 'https://x.test/b8.jpg', '', 'ninguno', ''));
  perform pg_temp.ok('B1 el administrador crea 7 banners y el 8.º activo se rechaza', array_length(b_ids, 1) = 7 and err like '%7 banners%', err);
  err := pg_temp.intenta('authenticated', format('select guardar_banner(null, %L, %L, %L, %L, %L, false)', 'principal', 'https://x.test/b8.jpg', '', 'ninguno', ''));
  perform pg_temp.ok('B2 un 8.º banner inactivo sí se puede guardar', err = 'ok', err);
  err := pg_temp.intenta('authenticated', format('select guardar_banner(null, %L, %L, %L, %L, %L, true)', 'intermedio', 'javascript:alert(1)', '', 'ninguno', ''));
  perform pg_temp.ok('B3 se rechaza una imagen que no sea https', err <> 'ok', err);
  err := pg_temp.intenta('authenticated', format('select guardar_banner(null, %L, %L, %L, %L, %L, true)', 'intermedio', 'https://x.test/i.jpg', '', 'url', 'http://inseguro.test'));
  perform pg_temp.ok('B4 se rechaza un enlace que no sea https', err <> 'ok', err);
  err := pg_temp.intenta('authenticated', format('select ordenar_banners(%L, %L::uuid[])', 'principal', (select array_agg(x order by o desc) from unnest(b_ids) with ordinality t(x, o))));
  perform pg_temp.ok('B5 reordenar banners', err = 'ok' and (select orden from promo_banners where id = b_ids[7]) = 1, err);
  perform pg_temp.ok('B6 la tienda recibe solo los 7 activos, en el nuevo orden',
    jsonb_array_length(pg_temp.lee('anon', 'select promociones_tienda()')->'banners') = 7
    and pg_temp.lee('anon', 'select promociones_tienda()')#>>'{banners,0,imagen}' = 'https://x.test/b7.jpg');

  -- Categorías
  select id into c_aud from categorias_tienda where nombre = 'Audio';
  select id into c_acc from categorias_tienda where nombre = 'Accesorios';
  r := pg_temp.lee('authenticated', format('select guardar_categoria(%L::uuid, %L, %L, true)', c_aud, 'Audio y sonido', 'https://x.test/c.jpg'));
  perform pg_temp.ok('C1 renombrar actualiza la categoría de sus productos',
    (r->>'productos_actualizados')::int >= 1 and not exists (select 1 from products where categoria = 'Audio')
    and exists (select 1 from products where id = p1 and categoria = 'Audio y sonido'), r::text);
  err := pg_temp.intenta('authenticated', format('select eliminar_categoria(%L::uuid)', c_aud));
  perform pg_temp.ok('C2 no se puede eliminar una categoría con productos', err like '%Ocultala o reasigná%', err);
  perform pg_temp.ok('C3 ningún producto se borró', (select count(*) from products where codigo like 'T005-%') = 2);
  err := pg_temp.intenta('authenticated', format('select guardar_categoria(null, %L, %L, true)', 'accesorios', ''));
  perform pg_temp.ok('C4 no se permite un nombre repetido (sin importar mayúsculas)', err like '%Ya existe%', err);
  r := pg_temp.lee('authenticated', format('select reasignar_categoria(%L::uuid, %L::uuid)', c_aud, c_acc));
  err := pg_temp.intenta('authenticated', format('select eliminar_categoria(%L::uuid)', c_aud));
  perform pg_temp.ok('C5 reasignar sus productos y después eliminarla', (r->>'productos_movidos')::int >= 1 and err = 'ok'
    and exists (select 1 from products where id = p1 and categoria = 'Accesorios'), err);
  perform pg_temp.lee('authenticated', format('select guardar_categoria(%L::uuid, %L, %L, false)', c_acc, 'Accesorios', ''));
  perform pg_temp.ok('C6 una categoría oculta no se muestra en la tienda',
    not (pg_temp.lee('anon', 'select promociones_tienda()')->'categorias') @> '[{"nombre":"Accesorios"}]'
    and (pg_temp.lee('anon', 'select promociones_tienda()')->'ocultas') ? 'Accesorios');

  -- Descuentos manuales
  r := pg_temp.lee('authenticated', format('select poner_descuento(%L::uuid, 20, null)', p1));
  v := pg_temp.lee('anon', 'select promociones_tienda()');
  perform pg_temp.ok('D1 descuento de 20 % visible en la tienda', exists (select 1 from jsonb_array_elements(v->'descuentos') x
    where x->>'productoId' = p1::text and (x->>'porcentaje')::int = 20 and x->>'origen' = 'manual'), v::text);
  perform pg_temp.ok('D2 precio con descuento exacto al peso: 33.475 − 20 % = 26.780', eldo_precio_con_descuento(33475, 20) = 26780);
  perform pg_temp.ok('D3 redondeo al peso: 1.999 − 35 % = 1.299 (1.299,35)', eldo_precio_con_descuento(1999, 35) = 1299);
  perform pg_temp.ok('D4 el precio habitual no cambió', (select precio from products where id = p1) = 33475);
  perform pg_temp.lee('authenticated', format('select poner_descuento(%L::uuid, 35, null)', p1));
  perform pg_temp.ok('D5 cambiar el % deja un solo descuento vigente (el anterior queda en el historial)',
    (select count(*) from descuentos_producto where product_id = p1) = 2
    and (select porcentaje from eldo_descuento_en(p1, now())) = 35);
  perform pg_temp.lee('authenticated', format('select quitar_descuento(%L::uuid)', p1));
  perform pg_temp.ok('D6 quitar el descuento vuelve al precio habitual', (select count(*) from eldo_descuento_en(p1, now())) = 0);
  err := pg_temp.intenta('authenticated', format('select poner_descuento(%L::uuid, 95, null)', p1));
  perform pg_temp.ok('D7 se rechaza un descuento mayor a 90 %', err <> 'ok', err);

  -- Descuento con fin y oferta flash: lo vencido deja de aplicarse
  insert into descuentos_producto (product_id, porcentaje, desde, hasta) values (p2, 10, now() - interval '2 days', now() - interval '1 day');
  perform pg_temp.ok('V1 un descuento vencido no aparece en la tienda',
    not exists (select 1 from jsonb_array_elements(pg_temp.lee('anon', 'select promociones_tienda()')->'descuentos') x where x->>'productoId' = p2::text));
  perform pg_temp.lee('authenticated', format('select poner_descuento(%L::uuid, 10, null)', p2));
  insert into ofertas_flash (id, titulo, inicia, termina) values (gen_random_uuid(), 'Flash vencida', now() - interval '3 hours', now() - interval '1 hour') returning id into f1;
  insert into ofertas_flash_productos values (f1, p2, 60, 1);
  perform pg_temp.ok('V2 una oferta flash vencida no aparece y el producto vuelve a su descuento anterior (10 %)',
    pg_temp.lee('anon', 'select promociones_tienda()')->'flash' = 'null'::jsonb
    and (select porcentaje from eldo_descuento_en(p2, now())) = 10);
  perform pg_temp.ok('V3 durante la flash valía 60 % (consulta en una fecha de ese período)',
    (select porcentaje from eldo_descuento_en(p2, now() - interval '2 hours')) = 60);
  r := pg_temp.lee('authenticated', format('select guardar_oferta_flash(%L, now() - interval ''1 minute'', now() + interval ''2 hours'', %L::jsonb)',
       'Flash de prueba', jsonb_build_array(jsonb_build_object('productId', p1, 'porcentaje', 35))));
  v := pg_temp.lee('anon', 'select promociones_tienda()');
  perform pg_temp.ok('V4 flash vigente: la tienda recibe título, fin y productos', v#>>'{flash,titulo}' = 'Flash de prueba'
    and (v#>>'{flash,productos,0}')::uuid = p1 and exists (select 1 from jsonb_array_elements(v->'descuentos') x
    where x->>'productoId' = p1::text and x->>'origen' = 'flash' and x->>'vence' is not null), v::text);
  perform pg_temp.lee('authenticated', 'select terminar_oferta_flash()');
  perform pg_temp.ok('V5 terminar la flash ahora la quita de inmediato', pg_temp.lee('anon', 'select promociones_tienda()')->'flash' = 'null'::jsonb
    and (select count(*) from eldo_descuento_en(p1, now())) = 0);

  -- Ventas con descuento: el precio lo calcula la base
  perform pg_temp.lee('authenticated', format('select poner_descuento(%L::uuid, 20, null)', p1));
  perform pg_temp.como(u_otro);  -- cualquier usuario habilitado registra ventas
  r := pg_temp.lee('authenticated', format('select registrar_venta_promocion(null, %L::jsonb, %L, %L, null)',
       jsonb_build_array(jsonb_build_object('productoId', p1, 'cantidad', 2, 'precioVenta', 1, 'descuento', jsonb_build_object('porcentaje', 20)),
                         jsonb_build_object('productoId', p2, 'cantidad', 1, 'precioVenta', 1999)), 'Efectivo', 'propia'));
  s1 := (r->>'id')::uuid;
  perform pg_temp.ok('S1 venta con descuento: la base ignora el precio enviado y usa 26.780',
    s1 is not null and (select (e->>'precioVenta')::numeric from sales, jsonb_array_elements(items::jsonb) e
                        where id = s1 and e->>'productoId' = p1::text) = 26780, r::text);
  perform pg_temp.ok('S2 total de la venta = 2 × 26.780 + 1.999 = 55.559', (select total from sales where id = s1) = 55559);
  perform pg_temp.ok('S3 queda el detalle del descuento (habitual 33.475, 20 %, manual)',
    exists (select 1 from ventas_descuentos where sale_id = s1 and product_id = p1 and precio_habitual = 33475
            and porcentaje = 20 and precio_aplicado = 26780 and origen = 'manual' and cantidad = 2));
  err := pg_temp.intenta('authenticated', format('select registrar_venta_promocion(null, %L::jsonb, %L, %L, null)',
       jsonb_build_array(jsonb_build_object('productoId', p1, 'cantidad', 1, 'descuento', jsonb_build_object('porcentaje', 60))), 'Efectivo', 'propia'));
  perform pg_temp.ok('S4 se rechaza un % que no está vigente', err like '%ya no es válido%', err);
  r := pg_temp.lee('authenticated', format('select registrar_venta_promocion(null, %L::jsonb, %L, %L, null, now() - interval ''2 hours'')',
       jsonb_build_array(jsonb_build_object('productoId', p2, 'cantidad', 1, 'descuento', jsonb_build_object('porcentaje', 60))), 'Efectivo', 'propia'));
  perform pg_temp.ok('S5 pedido hecho durante una flash ya vencida: se acepta con la fecha del pedido',
    r ? 'id' and exists (select 1 from ventas_descuentos where sale_id = (r->>'id')::uuid and origen = 'flash' and porcentaje = 60), r::text);
  err := pg_temp.intenta('authenticated', format('select registrar_venta_promocion(null, %L::jsonb, %L, %L, null, now() - interval ''8 days'')',
       jsonb_build_array(jsonb_build_object('productoId', p2, 'cantidad', 1)), 'Efectivo', 'propia'));
  perform pg_temp.ok('S6 no se aceptan fechas de pedido de más de 7 días', err like '%7 días%', err);
  perform pg_temp.ok('S7 el stock bajó como en cualquier venta', (select stock from products where id = p1) = 8);

  -- Datos comerciales intactos
  select string_agg(codigo || ':' || precio || ':' || costo || ':' || stock, ',' order by codigo) into despues
    from products where codigo not like 'T005-%';
  perform pg_temp.ok('X1 precios, costos, stock y códigos de los productos existentes sin cambios', antes = despues);
  perform pg_temp.ok('X2 la tienda sigue leyendo catalogo_tienda()', pg_temp.intenta('anon', 'select * from catalogo_tienda()') = 'ok');
  perform pg_temp.ok('X3 todo cambio quedó en la auditoría', (select count(*) from audit_log where tabla in
    ('promo_banners', 'categorias_tienda', 'descuentos_producto', 'ofertas_flash')) >= 15);
  perform set_config('request.jwt.claims', '', true);
end
$p$;
select prueba, ok, detalle from public.eldo_pruebas_005 order by n;
