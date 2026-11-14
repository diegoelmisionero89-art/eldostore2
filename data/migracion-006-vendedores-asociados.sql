-- =============================================================================
-- ELDOSTORE — Migración 006: VENDEDORES ASOCIADOS V1 («Tiendas asociadas»)
--
-- Versión para REVISIÓN · 13/11/2026 · NO se ejecutó en la base real.
-- Se instala SOLO con autorización de Diego (SQL Editor → pegar TODO → Run).
--
-- Qué hace (solo AGREGA; no modifica ni borra nada existente):
--   * 4 tablas nuevas, separadas de la tienda propia:
--       mkt_vendedores        vendedores asociados (nombre, logo, descripción, WhatsApp, comisión)
--       mkt_productos         productos de cada vendedor (precio, stock, estado de aprobación)
--       mkt_producto_fotos    fotos de esos productos
--       mkt_ventas            ventas asociadas con la comisión de ELDOSTORE (historial)
--   * Funciones para administrar todo desde el panel (solo el administrador) y una
--     función pública de lectura para la tienda: tiendas_asociadas().
--
-- Qué NO toca: products, precios, stock, ventas, compras, gastos, caja, cuentas,
-- usuarios, promociones, catalogo_tienda() ni promociones_tienda(). Los productos de
-- vendedores NUNCA aparecen en catalogo_tienda() («Todos los productos»): viven en
-- otra tabla y se publican solo por tiendas_asociadas().
--
-- Reglas:
--   * Un producto se ve en la tienda solo si: está APROBADO, su vendedor está ACTIVO
--     y tiene precio. Sin stock se muestra «Sin stock» y no se puede pedir.
--   * Comisión de ELDOSTORE: la del vendedor (10 % inicial), copiada en CADA venta
--     al registrarla. Si después cambia el %, las ventas anteriores no cambian.
--       comisión = total × % / 100 (al peso) · al vendedor = total − comisión.
--   * Las ventas no se borran: se anulan con motivo (devuelven el stock).
--   * El pago y la entrega los coordina el vendedor. Esta migración no mueve la caja
--     de ELDOSTORE; la comisión se marca como «cobrada» cuando el vendedor la paga.
--
-- Seguridad: una sola transacción; verificaciones previas; RLS en las tablas nuevas;
-- escritura solo por funciones que exigen al administrador (app_users.es_admin);
-- la tienda (anon) solo lee con tiendas_asociadas() (sin stock exacto, costos ni notas).
-- Reversión: data/migracion-006-revertir.sql
-- La última línea tiene que ser:  -- FIN DEL ARCHIVO 006
-- =============================================================================
begin;

-- -----------------------------------------------------------------------------
-- 0. VERIFICACIONES (si algo no coincide, se detiene sin cambiar nada)
-- -----------------------------------------------------------------------------
do $verificar$
declare n text;
begin
  foreach n in array array['mkt_vendedores', 'mkt_productos', 'mkt_producto_fotos', 'mkt_ventas'] loop
    if to_regclass('public.' || n) is not null then
      raise exception 'Ya existe la tabla %: la migración 006 parece aplicada. No se hizo ningún cambio.', n;
    end if;
  end loop;
  if to_regprocedure('public.eldo_es_admin()') is null or to_regprocedure('public.eldo_requiere_usuario()') is null
     or to_regprocedure('public.eldo_es_usuario_activo()') is null
     or to_regclass('public.audit_log') is null or to_regprocedure('public.eldo_auditar(text, text, uuid, jsonb)') is null then
    raise exception 'Falta la migración 003 (administrador, usuarios y auditoría). No se hizo ningún cambio.';
  end if;
  if to_regprocedure('public.tiendas_asociadas()') is not null then
    raise exception 'Ya existe tiendas_asociadas(). No se hizo ningún cambio.';
  end if;
end
$verificar$;

-- -----------------------------------------------------------------------------
-- 1. TABLAS
-- -----------------------------------------------------------------------------
create table public.mkt_vendedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (btrim(nombre) = nombre and length(nombre) between 2 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  descripcion text not null default '' check (length(descripcion) <= 600),
  logo_url text not null default '' check (logo_url = '' or (logo_url ~ '^https://[^[:space:]"''<>]+$' and length(logo_url) <= 1000)),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,15}$'),
  localidad text not null default '' check (length(localidad) <= 80),
  comision_pct numeric(5,2) not null default 10 check (comision_pct >= 0 and comision_pct <= 50),
  activo boolean not null default false,
  orden integer not null default 0,
  notas text not null default '' check (length(notas) <= 1000),       -- solo panel
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create unique index mkt_vendedores_slug_uq on public.mkt_vendedores (slug);
create unique index mkt_vendedores_nombre_uq on public.mkt_vendedores (lower(nombre));

create sequence public.mkt_productos_codigo_seq;
create table public.mkt_productos (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.mkt_vendedores (id) on delete restrict,
  codigo text not null check (codigo ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  nombre text not null check (btrim(nombre) = nombre and length(nombre) between 2 and 140),
  descripcion text not null default '' check (length(descripcion) <= 2000),
  categoria text not null default '' check (length(categoria) <= 60),
  precio numeric(12,2) not null check (precio > 0),
  stock integer not null default 0 check (stock >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'pausado', 'rechazado')),
  aprobado_en timestamptz,
  aprobado_por uuid,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create unique index mkt_productos_codigo_uq on public.mkt_productos (lower(codigo));
create index mkt_productos_vendedor_idx on public.mkt_productos (vendedor_id, estado);

create table public.mkt_producto_fotos (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.mkt_productos (id) on delete cascade,
  url text not null check (url ~ '^https://[^[:space:]"''<>]+$' and length(url) <= 1000),
  orden integer not null default 0
);
create index mkt_producto_fotos_idx on public.mkt_producto_fotos (producto_id, orden);

-- Ventas asociadas. Guardan una COPIA de los datos del momento (nombre, código,
-- precio, % de comisión) para que el historial no cambie aunque se edite el producto.
create table public.mkt_ventas (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  vendedor_id uuid not null references public.mkt_vendedores (id) on delete restrict,
  producto_id uuid references public.mkt_productos (id) on delete set null,
  vendedor_nombre text not null,
  producto_nombre text not null,
  producto_codigo text not null,
  cantidad integer not null check (cantidad between 1 and 9999),
  precio_unitario numeric(12,2) not null check (precio_unitario > 0),
  total numeric(14,2) not null check (total > 0),
  comision_pct numeric(5,2) not null check (comision_pct >= 0 and comision_pct <= 50),
  comision numeric(14,2) not null check (comision >= 0),
  monto_vendedor numeric(14,2) not null check (monto_vendedor >= 0),
  cliente text not null default '' check (length(cliente) <= 120),
  notas text not null default '' check (length(notas) <= 500),
  comision_cobrada boolean not null default false,
  comision_cobrada_en timestamptz,
  anulada boolean not null default false,
  anulada_en timestamptz,
  motivo_anulacion text not null default '',
  registrado_por uuid default auth.uid(),
  creado timestamptz not null default now(),
  check (comision + monto_vendedor = total)
);
create index mkt_ventas_vendedor_idx on public.mkt_ventas (vendedor_id, fecha desc);

-- -----------------------------------------------------------------------------
-- 2. AYUDAS
-- -----------------------------------------------------------------------------
create function public.mkt_requiere_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform eldo_requiere_usuario();
  if not eldo_es_admin() then
    raise exception 'Solo el administrador puede modificar las tiendas asociadas.';
  end if;
end $$;

-- «Tienda de Juan Pérez» → «tienda-de-juan-perez»
create function public.mkt_slug(p_texto text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(nullif(left(trim(both '-' from regexp_replace(lower(translate(coalesce(p_texto, ''),
    'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')),
    '[^a-z0-9]+', '-', 'g')), 60), ''), 'tienda')
$$;

-- -----------------------------------------------------------------------------
-- 3. VENDEDORES (solo administrador)
-- -----------------------------------------------------------------------------
create function public.mkt_guardar_vendedor(p_id uuid, p_datos jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := p_id;
  v_nombre text := btrim(coalesce(p_datos->>'nombre', ''));
  v_slug text;
  v_wa text := regexp_replace(coalesce(p_datos->>'whatsapp', ''), '[^0-9]', '', 'g');
  v_pct numeric := coalesce(nullif(p_datos->>'comision_pct', '')::numeric, 10);
  n integer := 1;
begin
  perform mkt_requiere_admin();
  if length(v_nombre) < 2 then raise exception 'Escribí el nombre comercial del vendedor.'; end if;
  if v_wa !~ '^[0-9]{10,15}$' then
    raise exception 'El WhatsApp tiene que tener entre 10 y 15 números, con código de país (ej.: 5493751123456).';
  end if;
  if v_pct < 0 or v_pct > 50 then raise exception 'La comisión tiene que estar entre 0 y 50 %%.'; end if;
  -- Dirección de su tienda: se arma una sola vez con el nombre y no cambia al editarlo (los enlaces siguen andando).
  if v_id is null then
    v_slug := mkt_slug(v_nombre);
    while exists (select 1 from mkt_vendedores where slug = v_slug) loop
      n := n + 1; v_slug := left(mkt_slug(v_nombre), 55) || '-' || n;
    end loop;
    insert into mkt_vendedores (nombre, slug, descripcion, logo_url, whatsapp, localidad, comision_pct, activo, orden, notas)
    values (v_nombre, v_slug, btrim(coalesce(p_datos->>'descripcion', '')), btrim(coalesce(p_datos->>'logo_url', '')),
            v_wa, btrim(coalesce(p_datos->>'localidad', '')), v_pct, coalesce((p_datos->>'activo')::boolean, false),
            (select coalesce(max(orden), 0) + 1 from mkt_vendedores), btrim(coalesce(p_datos->>'notas', '')))
    returning id into v_id;
  else
    update mkt_vendedores set nombre = v_nombre, descripcion = btrim(coalesce(p_datos->>'descripcion', '')),
           logo_url = btrim(coalesce(p_datos->>'logo_url', '')), whatsapp = v_wa,
           localidad = btrim(coalesce(p_datos->>'localidad', '')), comision_pct = v_pct,
           activo = coalesce((p_datos->>'activo')::boolean, activo), notas = btrim(coalesce(p_datos->>'notas', '')),
           actualizado = now()
     where id = v_id;
    if not found then raise exception 'El vendedor no existe.'; end if;
  end if;
  perform eldo_auditar('guardar', 'mkt_vendedores', v_id,
    jsonb_build_object('nombre', v_nombre, 'activo', (p_datos->>'activo'), 'comision_pct', v_pct));
  return jsonb_build_object('id', v_id);
end $$;

create function public.mkt_activar_vendedor(p_id uuid, p_activo boolean)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform mkt_requiere_admin();
  update mkt_vendedores set activo = p_activo, actualizado = now() where id = p_id;
  if not found then raise exception 'El vendedor no existe.'; end if;
  perform eldo_auditar(case when p_activo then 'activar' else 'desactivar' end, 'mkt_vendedores', p_id, '{}');
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 4. PRODUCTOS DE VENDEDORES (solo administrador)
-- -----------------------------------------------------------------------------
-- p_datos: vendedor_id, codigo (vacío = automático TA0001…), nombre, descripcion,
-- categoria, precio, stock, fotos (lista de direcciones, la primera es la principal).
-- Un producto NUEVO queda «pendiente» hasta que se apruebe. Editar uno aprobado
-- no lo despublica (lo edita el propio administrador).
create function public.mkt_guardar_producto(p_id uuid, p_datos jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := p_id;
  v_vend uuid := nullif(p_datos->>'vendedor_id', '')::uuid;
  v_codigo text := btrim(coalesce(p_datos->>'codigo', ''));
  v_nombre text := btrim(coalesce(p_datos->>'nombre', ''));
  v_precio numeric := nullif(p_datos->>'precio', '')::numeric;
  v_stock integer := coalesce(nullif(p_datos->>'stock', '')::integer, 0);
  v_url text; i integer := 0;
begin
  perform mkt_requiere_admin();
  if v_vend is null or not exists (select 1 from mkt_vendedores where id = v_vend) then
    raise exception 'Elegí a qué vendedor pertenece el producto.';
  end if;
  if length(v_nombre) < 2 then raise exception 'Escribí el nombre del producto.'; end if;
  if v_precio is null or v_precio <= 0 then raise exception 'El precio tiene que ser mayor que 0.'; end if;
  if v_stock < 0 then raise exception 'El stock no puede ser negativo.'; end if;
  if jsonb_typeof(coalesce(p_datos->'fotos', '[]')) <> 'array' or jsonb_array_length(coalesce(p_datos->'fotos', '[]')) > 10 then
    raise exception 'Hasta 10 fotos por producto.';
  end if;
  if v_codigo = '' then
    loop
      v_codigo := 'TA' || lpad(nextval('mkt_productos_codigo_seq')::text, 4, '0');
      exit when not exists (select 1 from mkt_productos where lower(codigo) = lower(v_codigo));
    end loop;
  elsif exists (select 1 from mkt_productos where lower(codigo) = lower(v_codigo) and id is distinct from v_id) then
    raise exception 'Ya hay otro producto asociado con el código %.', v_codigo;
  end if;
  if v_id is null then
    insert into mkt_productos (vendedor_id, codigo, nombre, descripcion, categoria, precio, stock)
    values (v_vend, v_codigo, v_nombre, btrim(coalesce(p_datos->>'descripcion', '')), btrim(coalesce(p_datos->>'categoria', '')),
            round(v_precio, 2), v_stock)
    returning id into v_id;
  else
    update mkt_productos set vendedor_id = v_vend, codigo = v_codigo, nombre = v_nombre,
           descripcion = btrim(coalesce(p_datos->>'descripcion', '')), categoria = btrim(coalesce(p_datos->>'categoria', '')),
           precio = round(v_precio, 2), stock = v_stock, actualizado = now()
     where id = v_id;
    if not found then raise exception 'El producto no existe.'; end if;
  end if;
  delete from mkt_producto_fotos where producto_id = v_id;
  for v_url in select btrim(x) from jsonb_array_elements_text(coalesce(p_datos->'fotos', '[]')) x loop
    if v_url <> '' then
      i := i + 1;
      insert into mkt_producto_fotos (producto_id, url, orden) values (v_id, v_url, i);
    end if;
  end loop;
  perform eldo_auditar('guardar', 'mkt_productos', v_id,
    jsonb_build_object('vendedor_id', v_vend, 'codigo', v_codigo, 'precio', v_precio, 'stock', v_stock));
  return jsonb_build_object('id', v_id, 'codigo', v_codigo);
end $$;

-- Aprobar (publicar), pausar o rechazar.
create function public.mkt_estado_producto(p_id uuid, p_estado text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform mkt_requiere_admin();
  if p_estado not in ('pendiente', 'aprobado', 'pausado', 'rechazado') then raise exception 'Estado no válido.'; end if;
  update mkt_productos set estado = p_estado, actualizado = now(),
         aprobado_en = case when p_estado = 'aprobado' then now() else aprobado_en end,
         aprobado_por = case when p_estado = 'aprobado' then auth.uid() else aprobado_por end
   where id = p_id;
  if not found then raise exception 'El producto no existe.'; end if;
  perform eldo_auditar('estado_' || p_estado, 'mkt_productos', p_id, '{}');
  return jsonb_build_object('ok', true);
end $$;

-- Borrar: solo si nunca tuvo ventas (si tuvo, se pausa para conservar el historial).
create function public.mkt_eliminar_producto(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform mkt_requiere_admin();
  if exists (select 1 from mkt_ventas where producto_id = p_id) then
    raise exception 'Este producto tiene ventas registradas: pausalo en lugar de borrarlo, así se conserva el historial.';
  end if;
  delete from mkt_productos where id = p_id;
  if not found then raise exception 'El producto no existe.'; end if;
  perform eldo_auditar('eliminar', 'mkt_productos', p_id, '{}');
  return jsonb_build_object('ok', true);   -- las fotos quedan en Storage
end $$;

-- -----------------------------------------------------------------------------
-- 5. VENTAS ASOCIADAS Y COMISIÓN (solo administrador)
-- -----------------------------------------------------------------------------
-- La base calcula todo: precio (el del producto, salvo que se indique otro precio
-- pactado), total, comisión con el % ACTUAL del vendedor y lo que le corresponde.
-- Descuenta el stock del producto asociado.
create function public.mkt_registrar_venta(p_datos jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  p mkt_productos%rowtype; v mkt_vendedores%rowtype;
  v_cant integer := nullif(p_datos->>'cantidad', '')::integer;
  v_precio numeric; v_total numeric; v_com numeric; v_id uuid;
  v_fecha timestamptz := coalesce(nullif(p_datos->>'fecha', '')::timestamptz, now());
begin
  perform mkt_requiere_admin();
  select * into p from mkt_productos where id = nullif(p_datos->>'producto_id', '')::uuid for update;
  if not found then raise exception 'Elegí el producto vendido.'; end if;
  select * into v from mkt_vendedores where id = p.vendedor_id;
  if v_cant is null or v_cant < 1 then raise exception 'La cantidad tiene que ser 1 o más.'; end if;
  if p.stock < v_cant then
    raise exception 'Stock insuficiente de % (hay %). Actualizá el stock antes de registrar la venta.', p.codigo, p.stock;
  end if;
  if v_fecha > now() + interval '5 minutes' or v_fecha < now() - interval '60 days' then
    raise exception 'La fecha de la venta tiene que estar entre los últimos 60 días y hoy.';
  end if;
  v_precio := round(coalesce(nullif(p_datos->>'precio_unitario', '')::numeric, p.precio), 2);
  if v_precio <= 0 then raise exception 'El precio tiene que ser mayor que 0.'; end if;
  v_total := round(v_precio * v_cant, 2);
  v_com := round(v_total * v.comision_pct / 100, 0);
  insert into mkt_ventas (fecha, vendedor_id, producto_id, vendedor_nombre, producto_nombre, producto_codigo, cantidad,
                          precio_unitario, total, comision_pct, comision, monto_vendedor, cliente, notas)
  values (v_fecha, v.id, p.id, v.nombre, p.nombre, p.codigo, v_cant, v_precio, v_total, v.comision_pct, v_com,
          v_total - v_com, btrim(coalesce(p_datos->>'cliente', '')), btrim(coalesce(p_datos->>'notas', '')))
  returning id into v_id;
  update mkt_productos set stock = stock - v_cant, actualizado = now() where id = p.id;
  perform eldo_auditar('registrar', 'mkt_ventas', v_id,
    jsonb_build_object('vendedor', v.nombre, 'codigo', p.codigo, 'cantidad', v_cant, 'total', v_total, 'comision', v_com));
  return jsonb_build_object('id', v_id, 'total', v_total, 'comision', v_com, 'monto_vendedor', v_total - v_com);
end $$;

create function public.mkt_anular_venta(p_id uuid, p_motivo text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r mkt_ventas%rowtype;
begin
  perform mkt_requiere_admin();
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indicá el motivo de la anulación.'; end if;
  select * into r from mkt_ventas where id = p_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if r.anulada then raise exception 'La venta ya estaba anulada.'; end if;
  update mkt_ventas set anulada = true, anulada_en = now(), motivo_anulacion = btrim(p_motivo) where id = p_id;
  if r.producto_id is not null then
    update mkt_productos set stock = stock + r.cantidad, actualizado = now() where id = r.producto_id;
  end if;
  perform eldo_auditar('anular', 'mkt_ventas', p_id, jsonb_build_object('motivo', btrim(p_motivo)));
  return jsonb_build_object('ok', true);
end $$;

create function public.mkt_comision_cobrada(p_id uuid, p_cobrada boolean)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform mkt_requiere_admin();
  update mkt_ventas set comision_cobrada = p_cobrada, comision_cobrada_en = case when p_cobrada then now() end
   where id = p_id and not anulada;
  if not found then raise exception 'La venta no existe o está anulada.'; end if;
  perform eldo_auditar(case when p_cobrada then 'comision_cobrada' else 'comision_pendiente' end, 'mkt_ventas', p_id, '{}');
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 6. LECTURA
-- -----------------------------------------------------------------------------
-- Tienda pública: solo vendedores activos y productos aprobados con precio.
-- No envía stock exacto, notas, comisiones ni ventas.
create function public.tiendas_asociadas()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'slug', v.slug, 'nombre', v.nombre,
                     'descripcion', v.descripcion, 'logo', v.logo_url, 'whatsapp', v.whatsapp, 'localidad', v.localidad,
                     'productos', (select count(*) from mkt_productos p where p.vendedor_id = v.id and p.estado = 'aprobado'))
                     order by v.orden, v.nombre)
                   from mkt_vendedores v where v.activo), '[]'),
    'productos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'vendedorId', p.vendedor_id, 'codigo', p.codigo,
                     'nombre', p.nombre, 'descripcion', p.descripcion, 'categoria', p.categoria, 'precio', p.precio,
                     'disponible', p.stock > 0,
                     'fotos', coalesce((select jsonb_agg(f.url order by f.orden) from mkt_producto_fotos f where f.producto_id = p.id), '[]'))
                     order by p.nombre)
                   from mkt_productos p join mkt_vendedores v on v.id = p.vendedor_id
                   where v.activo and p.estado = 'aprobado'), '[]'))
$$;

-- Panel: todo, para usuarios habilitados (solo el administrador puede modificar).
create function public.mkt_panel()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform eldo_requiere_usuario();
  return jsonb_build_object(
    'esAdmin', eldo_es_admin(),
    'vendedores', coalesce((select jsonb_agg(to_jsonb(v) order by v.orden, v.nombre) from mkt_vendedores v), '[]'),
    'productos', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('fotos',
                    coalesce((select jsonb_agg(f.url order by f.orden) from mkt_producto_fotos f where f.producto_id = p.id), '[]'))
                    order by p.creado desc) from mkt_productos p), '[]'),
    'ventas', coalesce((select jsonb_agg(to_jsonb(s) order by s.fecha desc) from mkt_ventas s), '[]'));
end $$;

-- -----------------------------------------------------------------------------
-- 7. PERMISOS
-- -----------------------------------------------------------------------------
do $permisos$
declare t text; f record;
begin
  foreach t in array array['mkt_vendedores', 'mkt_productos', 'mkt_producto_fotos', 'mkt_ventas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy lectura_usuarios_habilitados on public.%I for select to authenticated using (public.eldo_es_usuario_activo())', t);
  end loop;
  revoke all on sequence public.mkt_productos_codigo_seq from anon, authenticated;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('mkt_requiere_admin', 'mkt_slug', 'mkt_guardar_vendedor',
             'mkt_activar_vendedor', 'mkt_guardar_producto', 'mkt_estado_producto', 'mkt_eliminar_producto',
             'mkt_registrar_venta', 'mkt_anular_venta', 'mkt_comision_cobrada', 'tiendas_asociadas', 'mkt_panel') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end
$permisos$;

grant execute on function public.tiendas_asociadas() to anon, authenticated;
grant execute on function
  public.mkt_panel(),
  public.mkt_guardar_vendedor(uuid, jsonb),
  public.mkt_activar_vendedor(uuid, boolean),
  public.mkt_guardar_producto(uuid, jsonb),
  public.mkt_estado_producto(uuid, text),
  public.mkt_eliminar_producto(uuid),
  public.mkt_registrar_venta(jsonb),
  public.mkt_anular_venta(uuid, text),
  public.mkt_comision_cobrada(uuid, boolean)
to authenticated;

commit;

-- Si llegaste hasta acá sin errores, la migración quedó aplicada.
select 'Migración 006 instalada correctamente' as resultado,
       (select count(*) from public.catalogo_tienda()) as productos_propios_en_la_tienda,
       jsonb_array_length(public.tiendas_asociadas()->'vendedores') as tiendas_asociadas_publicadas;
-- FIN DEL ARCHIVO 006
