-- =============================================================================
-- ELDOSTORE — Verificación de la 005 en la base REAL, sin dejar rastros.
-- Todo corre dentro de una transacción que al final se DESHACE (rollback):
-- la venta, el descuento y los cambios de prueba no quedan guardados.
-- Muestra solo nombres de controles y OK/FALLA (el registro de GitHub es público).
-- Si un control falla, se detiene con error (y también se deshace todo).
-- =============================================================================
\set ON_ERROR_STOP 1
begin;
create temp table v005 (n serial, control text, ok boolean) on commit drop;

do $v$
declare
  u_admin uuid; p record; r jsonb; err text; stock0 int; esperado numeric; ventas0 int; extra uuid := gen_random_uuid();
begin
  execute $f$ create or replace function pg_temp.ok(t text, c boolean) returns void language sql as
    $b$ insert into v005 (control, ok) values (t, coalesce(c, false)) $b$ $f$;
  execute $f$ create or replace function pg_temp.como(u uuid) returns void language sql as
    $b$ select set_config('request.jwt.claims', case when u is null then '' else json_build_object('sub', u, 'role', 'authenticated')::text end, true) $b$ $f$;
  execute $f$ create or replace function pg_temp.lee(rol text, q text) returns jsonb language plpgsql as
    $b$ declare x jsonb; begin execute format('set local role %I', rol); execute q into x; execute 'reset role'; return x;
        exception when others then execute 'reset role'; return jsonb_build_object('error', sqlerrm); end $b$ $f$;

  select user_id into u_admin from app_users where es_admin and activo;
  perform pg_temp.ok('Hay un único administrador activo', (select count(*) from app_users where es_admin and activo) = 1);

  -- Producto real con stock y precio, para una venta de prueba que después se deshace
  select pr.id, pr.precio, pr.stock into p from products pr
   where pr.precio > 0 and pr.stock >= 1 order by pr.stock desc limit 1;
  if p.id is null then raise exception 'No hay un producto con stock para la venta de prueba'; end if;
  stock0 := p.stock; esperado := round(p.precio * 80 / 100); ventas0 := (select count(*) from sales);

  -- Permisos
  perform pg_temp.como(extra);
  r := pg_temp.lee('authenticated', format($q$select to_jsonb(guardar_banner(null, 'principal', 'https://x.test/a.jpg', '', 'ninguno', '', true))$q$));
  perform pg_temp.ok('Un usuario que no es el administrador no puede crear banners', coalesce(r->>'error', '') <> '');
  r := pg_temp.lee('authenticated', format('select to_jsonb(poner_descuento(%L::uuid, 10, null))', p.id));
  perform pg_temp.ok('Un usuario que no es el administrador no puede poner descuentos', coalesce(r->>'error', '') <> '');
  perform pg_temp.como(null);
  r := pg_temp.lee('anon', $q$select to_jsonb(count(*)) from promo_banners$q$);
  perform pg_temp.ok('Un visitante no puede leer las tablas internas', coalesce(r->>'error', '') <> '');
  r := pg_temp.lee('anon', $q$select promociones_panel()$q$);
  perform pg_temp.ok('Un visitante no puede usar las funciones del panel', coalesce(r->>'error', '') <> '');
  r := pg_temp.lee('anon', $q$select promociones_tienda()$q$);
  perform pg_temp.ok('La tienda puede leer las promociones', r ? 'ahora' and not r ? 'error');
  r := pg_temp.lee('anon', $q$select to_jsonb(count(*)) from catalogo_tienda()$q$);
  perform pg_temp.ok('La tienda sigue leyendo el catálogo', (r #>> '{}')::int > 0);

  -- Administrador: descuento y venta con descuento
  perform pg_temp.como(u_admin);
  r := pg_temp.lee('authenticated', format('select to_jsonb(poner_descuento(%L::uuid, 20, null))', p.id));
  perform pg_temp.ok('El administrador puede poner un descuento', not r ? 'error');
  r := pg_temp.lee('authenticated', 'select promociones_panel()');
  perform pg_temp.ok('El panel ve el descuento', r ? 'descuentos' and jsonb_array_length(r->'descuentos') >= 1 and (r->>'esAdmin')::boolean);
  r := pg_temp.lee('authenticated', format('select to_jsonb(registrar_venta_promocion(null, %L::jsonb, %L, %L, null))',
       jsonb_build_array(jsonb_build_object('productoId', p.id, 'cantidad', 1, 'precioVenta', 1, 'descuento', jsonb_build_object('porcentaje', 20))),
       'Efectivo', 'propia'));
  perform pg_temp.ok('Venta con descuento registrada', r ? 'id');
  perform pg_temp.ok('La base calculó el precio con 20 % (ignora el enviado)', (r->>'total')::numeric = esperado);
  perform pg_temp.ok('El stock bajó 1 unidad', (select stock from products where id = p.id) = stock0 - 1);
  perform pg_temp.ok('Quedó el detalle del descuento', exists (select 1 from ventas_descuentos where sale_id = (r->>'id')::uuid and porcentaje = 20 and precio_aplicado = esperado));
  perform pg_temp.ok('El precio habitual no cambió', (select precio from products where id = p.id) = p.precio);
  r := pg_temp.lee('authenticated', format('select to_jsonb(registrar_venta_promocion(null, %L::jsonb, %L, %L, null))',
       jsonb_build_array(jsonb_build_object('productoId', p.id, 'cantidad', 1, 'descuento', jsonb_build_object('porcentaje', 55))), 'Efectivo', 'propia'));
  perform pg_temp.ok('Se rechaza un descuento que no está vigente', coalesce(r->>'error', '') <> '');
  r := pg_temp.lee('authenticated', format('select to_jsonb(quitar_descuento(%L::uuid))', p.id));
  perform pg_temp.ok('El administrador puede quitar el descuento', not r ? 'error');
  perform pg_temp.ok('Una sola venta de prueba en esta transacción', (select count(*) from sales) = ventas0 + 1);
end $v$;

select n, control, case when ok then 'OK' else 'FALLA' end as resultado from v005 order by n;
do $f$ begin if exists (select 1 from v005 where not ok) then raise exception 'Hay controles con FALLA'; end if; end $f$;
-- Reglas de consistencia de la V003 con la venta de prueba incluida (tienen que dar 0)
\i data/migracion-003-invariantes.sql
rollback;
select 'Verificación terminada: todo deshecho, la base quedó como estaba' as resultado;
