-- =============================================================================
-- ELDOSTORE — Migración 005: promociones administradas desde el panel
--   banners (principal e intermedio), categorías visuales, descuentos por
--   producto, ofertas flash y registro del descuento en las ventas.
--
-- Versión para REVISIÓN · 04/11/2026 · NO se ejecutó en la base real.
-- Orden previsto: primero en el proyecto Supabase de PRUEBAS (copia restaurada
-- del respaldo), después en producción solo con autorización de Diego.
--
-- Qué hace (solo AGREGA; no modifica ni borra datos existentes):
--   * 6 tablas nuevas: promo_banners, categorias_tienda, descuentos_producto,
--     ofertas_flash, ofertas_flash_productos, ventas_descuentos.
--   * Funciones nuevas para que el panel administre todo (solo el administrador)
--     y una función pública de lectura para la tienda: promociones_tienda().
--   * Función nueva registrar_venta_promocion(): registra una venta con descuento
--     calculando el precio en la base y guardando el detalle del descuento.
--   * Carga inicial de categorias_tienda con las categorías que ya usan los productos.
--
-- Qué NO toca: precios, costos, stock ni códigos de products; ventas, compras,
-- gastos ni caja existentes; catalogo_tienda(); las funciones de la V003.
-- Única excepción, a pedido expreso de Diego: al RENOMBRAR o REASIGNAR una
-- categoría desde el panel se actualiza products.categoria (solo esa columna,
-- solo de los productos de esa categoría, con registro en audit_log).
--
-- Reglas de precio:
--   * Precio con descuento = precio habitual × (100 − %) / 100, redondeado al peso
--     (sin otros redondeos). El precio habitual (products.precio) no cambia.
--   * Si un producto está en una oferta flash vigente, vale el % de la flash.
--     Si no, vale su descuento manual vigente (si tiene). Si no, el precio habitual.
--   * Al vencer la flash, el producto vuelve solo a su precio anterior.
--   * Los descuentos y ofertas no se borran: se cierran con fecha (historial), así
--     una venta puede validar el descuento que estaba vigente al momento del pedido.
--
-- Seguridad: una sola transacción; verificaciones previas; RLS en todas las tablas
-- nuevas; escritura solo por funciones que exigen al administrador (Diego);
-- la tienda (anon) solo lee con promociones_tienda().
-- Cómo correrla: SQL Editor → pegar TODO → la última línea tiene que ser
--   -- FIN DEL ARCHIVO 005
-- Reversión: data/migracion-005-revertir.sql
-- =============================================================================
begin;

-- -----------------------------------------------------------------------------
-- 0. VERIFICACIONES (si algo no coincide, se detiene sin cambiar nada)
-- -----------------------------------------------------------------------------
do $verificar$
declare n text;
begin
  foreach n in array array['promo_banners','categorias_tienda','descuentos_producto','ofertas_flash',
                           'ofertas_flash_productos','ventas_descuentos'] loop
    if to_regclass('public.' || n) is not null then
      raise exception 'Ya existe la tabla %: la migración 005 parece aplicada. No se hizo ningún cambio.', n;
    end if;
  end loop;
  if to_regprocedure('public.eldo_es_admin()') is null or to_regprocedure('public.eldo_requiere_usuario()') is null
     or to_regclass('public.audit_log') is null or to_regprocedure('public.eldo_auditar(text, text, uuid, jsonb)') is null then
    raise exception 'Falta la migración 003 (administrador, usuarios y auditoría). No se hizo ningún cambio.';
  end if;
  if to_regprocedure('public.register_sale_v3(uuid, jsonb, text, text, uuid)') is null then
    raise exception 'No existe register_sale_v3 (migración 003). No se hizo ningún cambio.';
  end if;
  if to_regprocedure('public.catalogo_tienda()') is null then
    raise exception 'No existe catalogo_tienda(). No se hizo ningún cambio.';
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'products' and column_name = 'id') is distinct from 'uuid'
     or (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'products' and column_name = 'categoria') is distinct from 'text'
     or (select data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'products' and column_name = 'precio') is distinct from 'numeric' then
    raise exception 'products.id / categoria / precio no tienen los tipos esperados (uuid / text / numeric). No se hizo ningún cambio.';
  end if;
  begin
    perform c.id from public.catalogo_tienda() c limit 1;
  exception when undefined_column then
    raise exception 'catalogo_tienda() no devuelve la columna id. No se hizo ningún cambio.';
  end;
end
$verificar$;

-- -----------------------------------------------------------------------------
-- 1. TABLAS
-- -----------------------------------------------------------------------------
-- Banners: "principal" (carrusel de arriba, hasta 7 activos) e "intermedio"
-- (carrusel entre productos, cada ~14). Un solo sistema para los dos.
create table public.promo_banners (
  id uuid primary key default gen_random_uuid(),
  ubicacion text not null check (ubicacion in ('principal', 'intermedio')),
  imagen_url text not null check (imagen_url ~ '^https://[^[:space:]"''<>]+$' and length(imagen_url) <= 1000),
  texto_alt text not null default '' check (length(texto_alt) <= 160),
  enlace_tipo text not null default 'ninguno' check (enlace_tipo in ('ninguno', 'producto', 'categoria', 'url')),
  enlace_valor text not null default '' check (length(enlace_valor) <= 500),
  orden integer not null default 0,
  activo boolean not null default true,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  check (enlace_tipo <> 'url' or enlace_valor ~ '^https://[^[:space:]"''<>]+$'),
  check (enlace_tipo = 'ninguno' or enlace_valor <> '')
);
create index promo_banners_orden_idx on public.promo_banners (ubicacion, orden);

-- Categorías visuales. "nombre" es el mismo texto que products.categoria.
create table public.categorias_tienda (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (btrim(nombre) = nombre and nombre <> '' and length(nombre) <= 60),
  imagen_url text not null default '' check (imagen_url = '' or (imagen_url ~ '^https://[^[:space:]"''<>]+$' and length(imagen_url) <= 1000)),
  orden integer not null default 0,
  visible boolean not null default true,
  creado timestamptz not null default now()
);
create unique index categorias_tienda_nombre_uq on public.categorias_tienda (lower(nombre));

-- Descuento manual por producto. Nunca se borra: "quitar" pone quitado_en.
create table public.descuentos_producto (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  porcentaje integer not null check (porcentaje between 1 and 90),
  desde timestamptz not null default now(),
  hasta timestamptz,
  quitado_en timestamptz,
  creado_por uuid default auth.uid(),
  creado timestamptz not null default now(),
  check (hasta is null or hasta > desde)
);
create index descuentos_producto_idx on public.descuentos_producto (product_id, desde);

-- Ofertas flash (historial). Solo puede haber UNA vigente o programada a la vez.
create table public.ofertas_flash (
  id uuid primary key default gen_random_uuid(),
  titulo text not null default 'Ofertas flash' check (length(titulo) between 1 and 80),
  inicia timestamptz not null,
  termina timestamptz not null,
  cancelada_en timestamptz,
  creada_por uuid default auth.uid(),
  creada timestamptz not null default now(),
  check (termina > inicia)
);
create table public.ofertas_flash_productos (
  oferta_id uuid not null references public.ofertas_flash (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  porcentaje integer not null check (porcentaje between 1 and 90),
  orden integer not null default 0,
  primary key (oferta_id, product_id)
);

-- Detalle del descuento de cada línea vendida con promoción (para reportes y control).
create table public.ventas_descuentos (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id),
  product_id uuid not null references public.products (id),
  cantidad numeric not null,
  precio_habitual numeric not null,
  porcentaje integer not null,
  precio_aplicado numeric not null,
  origen text not null check (origen in ('manual', 'flash')),
  referencia uuid not null,               -- id del descuento o de la oferta flash
  fecha_pedido timestamptz not null,      -- momento en que se validó el descuento
  registrado_por uuid default auth.uid(),
  registrado timestamptz not null default now()
);
create index ventas_descuentos_venta_idx on public.ventas_descuentos (sale_id);

-- -----------------------------------------------------------------------------
-- 2. REGLA DE PRECIO (una sola, la usan la tienda, el panel y las ventas)
-- -----------------------------------------------------------------------------
-- Descuento vigente de un producto en el momento t: primero la flash, después el manual.
create function public.eldo_descuento_en(p_product_id uuid, p_t timestamptz)
returns table (porcentaje integer, origen text, referencia uuid, vence timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  (select fp.porcentaje, 'flash'::text, f.id, f.termina
     from ofertas_flash f join ofertas_flash_productos fp on fp.oferta_id = f.id
    where fp.product_id = p_product_id and f.inicia <= p_t and p_t < f.termina
      and (f.cancelada_en is null or p_t < f.cancelada_en)
    order by f.inicia desc limit 1)
  union all
  (select d.porcentaje, 'manual'::text, d.id,
          nullif(least(coalesce(d.hasta, 'infinity'), coalesce(d.quitado_en, 'infinity')), 'infinity')
     from descuentos_producto d
    where d.product_id = p_product_id and d.desde <= p_t
      and (d.hasta is null or p_t < d.hasta) and (d.quitado_en is null or p_t < d.quitado_en)
      and not exists (select 1 from ofertas_flash f join ofertas_flash_productos fp on fp.oferta_id = f.id
                      where fp.product_id = p_product_id and f.inicia <= p_t and p_t < f.termina
                        and (f.cancelada_en is null or p_t < f.cancelada_en))
    order by d.desde desc limit 1)
$$;

-- Precio con descuento: exacto del porcentaje, redondeado al peso.
create function public.eldo_precio_con_descuento(p_precio numeric, p_porcentaje integer)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select round(p_precio * (100 - p_porcentaje) / 100.0, 0)
$$;

create function public.eldo_requiere_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform eldo_requiere_usuario();
  if not eldo_es_admin() then
    raise exception 'Solo el administrador puede modificar las promociones de la tienda.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. BANNERS (solo administrador)
-- -----------------------------------------------------------------------------
create function public.guardar_banner(p_id uuid, p_ubicacion text, p_imagen_url text, p_texto_alt text,
  p_enlace_tipo text, p_enlace_valor text, p_activo boolean)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid := p_id; v_orden integer;
begin
  perform eldo_requiere_admin();
  if p_activo and p_ubicacion = 'principal' and (select count(*) from promo_banners
      where ubicacion = 'principal' and activo and id is distinct from p_id) >= 7 then
    raise exception 'Ya hay 7 banners principales activos. Desactivá uno antes de activar otro.';
  end if;
  if v_id is null then
    select coalesce(max(orden), 0) + 1 into v_orden from promo_banners where ubicacion = p_ubicacion;
    insert into promo_banners (ubicacion, imagen_url, texto_alt, enlace_tipo, enlace_valor, orden, activo)
    values (p_ubicacion, btrim(p_imagen_url), btrim(coalesce(p_texto_alt, '')), coalesce(p_enlace_tipo, 'ninguno'),
            btrim(coalesce(p_enlace_valor, '')), v_orden, coalesce(p_activo, true))
    returning id into v_id;
  else
    update promo_banners set ubicacion = p_ubicacion, imagen_url = btrim(p_imagen_url),
           texto_alt = btrim(coalesce(p_texto_alt, '')), enlace_tipo = coalesce(p_enlace_tipo, 'ninguno'),
           enlace_valor = btrim(coalesce(p_enlace_valor, '')), activo = coalesce(p_activo, true), actualizado = now()
     where id = v_id;
    if not found then raise exception 'El banner no existe.'; end if;
  end if;
  perform eldo_auditar('guardar', 'promo_banners', v_id, jsonb_build_object('ubicacion', p_ubicacion, 'activo', p_activo));
  return jsonb_build_object('id', v_id);
end $$;

create function public.ordenar_banners(p_ubicacion text, p_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare i integer;
begin
  perform eldo_requiere_admin();
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update promo_banners set orden = i, actualizado = now() where id = p_ids[i] and ubicacion = p_ubicacion;
  end loop;
  perform eldo_auditar('ordenar', 'promo_banners', null, jsonb_build_object('ubicacion', p_ubicacion, 'ids', p_ids));
  return jsonb_build_object('ok', true);
end $$;

create function public.eliminar_banner(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform eldo_requiere_admin();
  delete from promo_banners where id = p_id;
  if not found then raise exception 'El banner no existe.'; end if;
  perform eldo_auditar('eliminar', 'promo_banners', p_id, '{}');
  return jsonb_build_object('ok', true);  -- la imagen queda en Storage
end $$;

-- -----------------------------------------------------------------------------
-- 4. CATEGORÍAS (solo administrador)
-- -----------------------------------------------------------------------------
-- Crear o editar. Si cambia el nombre, se actualiza products.categoria de SUS
-- productos (solo esa columna). Nunca toca precios, costos, stock ni códigos.
create function public.guardar_categoria(p_id uuid, p_nombre text, p_imagen_url text, p_visible boolean)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_nombre text := btrim(coalesce(p_nombre, '')); v_anterior text; v_id uuid := p_id;
        v_orden integer; v_movidos integer := 0;
begin
  perform eldo_requiere_admin();
  if v_nombre = '' then raise exception 'Escribí el nombre de la categoría.'; end if;
  if exists (select 1 from categorias_tienda where lower(nombre) = lower(v_nombre) and id is distinct from p_id) then
    raise exception 'Ya existe una categoría llamada "%".', v_nombre;
  end if;
  if v_id is null then
    select coalesce(max(orden), 0) + 1 into v_orden from categorias_tienda;
    insert into categorias_tienda (nombre, imagen_url, orden, visible)
    values (v_nombre, btrim(coalesce(p_imagen_url, '')), v_orden, coalesce(p_visible, true))
    returning id into v_id;
  else
    select nombre into v_anterior from categorias_tienda where id = v_id for update;
    if not found then raise exception 'La categoría no existe.'; end if;
    update categorias_tienda set nombre = v_nombre, imagen_url = btrim(coalesce(p_imagen_url, '')),
           visible = coalesce(p_visible, true) where id = v_id;
    if v_anterior <> v_nombre then
      update products set categoria = v_nombre where categoria = v_anterior;
      get diagnostics v_movidos = row_count;
    end if;
  end if;
  perform eldo_auditar('guardar', 'categorias_tienda', v_id,
    jsonb_build_object('nombre', v_nombre, 'nombre_anterior', v_anterior, 'productos_actualizados', v_movidos));
  return jsonb_build_object('id', v_id, 'productos_actualizados', v_movidos);
end $$;

create function public.ordenar_categorias(p_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare i integer;
begin
  perform eldo_requiere_admin();
  for i in 1 .. coalesce(array_length(p_ids, 1), 0) loop
    update categorias_tienda set orden = i where id = p_ids[i];
  end loop;
  perform eldo_auditar('ordenar', 'categorias_tienda', null, jsonb_build_object('ids', p_ids));
  return jsonb_build_object('ok', true);
end $$;

-- Pasa todos los productos de una categoría a otra (solo products.categoria).
create function public.reasignar_categoria(p_origen_id uuid, p_destino_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_origen text; v_destino text; v_movidos integer;
begin
  perform eldo_requiere_admin();
  select nombre into v_origen from categorias_tienda where id = p_origen_id;
  select nombre into v_destino from categorias_tienda where id = p_destino_id;
  if v_origen is null or v_destino is null then raise exception 'Categoría inexistente.'; end if;
  if p_origen_id = p_destino_id then raise exception 'Elegí una categoría de destino distinta.'; end if;
  update products set categoria = v_destino where categoria = v_origen;
  get diagnostics v_movidos = row_count;
  perform eldo_auditar('reasignar', 'categorias_tienda', p_origen_id,
    jsonb_build_object('de', v_origen, 'a', v_destino, 'productos', v_movidos));
  return jsonb_build_object('productos_movidos', v_movidos);
end $$;

-- Eliminar solo si ningún producto la usa. Nunca elimina productos.
create function public.eliminar_categoria(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_nombre text; v_n integer;
begin
  perform eldo_requiere_admin();
  select nombre into v_nombre from categorias_tienda where id = p_id for update;
  if v_nombre is null then raise exception 'La categoría no existe.'; end if;
  select count(*) into v_n from products where categoria = v_nombre;
  if v_n > 0 then
    raise exception 'La categoría "%" tiene % producto(s). Ocultala o reasigná sus productos a otra categoría antes de eliminarla.', v_nombre, v_n;
  end if;
  delete from categorias_tienda where id = p_id;
  perform eldo_auditar('eliminar', 'categorias_tienda', p_id, jsonb_build_object('nombre', v_nombre));
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 5. DESCUENTOS POR PRODUCTO Y OFERTAS FLASH (solo administrador)
-- -----------------------------------------------------------------------------
-- Pone (o cambia) el descuento manual de un producto. El anterior queda cerrado.
create function public.poner_descuento(p_product_id uuid, p_porcentaje integer, p_hasta timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform eldo_requiere_admin();
  if not exists (select 1 from products where id = p_product_id) then raise exception 'El producto no existe.'; end if;
  if p_porcentaje is null or p_porcentaje not between 1 and 90 then raise exception 'El descuento tiene que ser de 1 a 90 %%.'; end if;
  if p_hasta is not null and p_hasta <= now() then raise exception 'La fecha de fin ya pasó.'; end if;
  update descuentos_producto set quitado_en = now()
   where product_id = p_product_id and quitado_en is null and (hasta is null or hasta > now());
  insert into descuentos_producto (product_id, porcentaje, hasta) values (p_product_id, p_porcentaje, p_hasta)
  returning id into v_id;
  perform eldo_auditar('poner_descuento', 'descuentos_producto', v_id,
    jsonb_build_object('producto', p_product_id, 'porcentaje', p_porcentaje, 'hasta', p_hasta));
  return jsonb_build_object('id', v_id);
end $$;

create function public.quitar_descuento(p_product_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  perform eldo_requiere_admin();
  update descuentos_producto set quitado_en = now()
   where product_id = p_product_id and quitado_en is null and (hasta is null or hasta > now());
  get diagnostics v_n = row_count;
  perform eldo_auditar('quitar_descuento', 'descuentos_producto', null, jsonb_build_object('producto', p_product_id, 'cerrados', v_n));
  return jsonb_build_object('quitados', v_n);
end $$;

-- Crea o reemplaza la oferta flash (una sola a la vez). p_productos:
-- [{"productId": "...", "porcentaje": 20}, ...] en el orden en que se muestran.
create function public.guardar_oferta_flash(p_titulo text, p_inicia timestamptz, p_termina timestamptz, p_productos jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid; it jsonb; i integer := 0; v_pid uuid; v_pct integer;
begin
  perform eldo_requiere_admin();
  if p_inicia is null or p_termina is null or p_termina <= p_inicia then raise exception 'Revisá las fechas: el fin tiene que ser posterior al inicio.'; end if;
  if p_termina <= now() then raise exception 'La fecha de fin ya pasó.'; end if;
  if jsonb_typeof(p_productos) <> 'array' or jsonb_array_length(p_productos) = 0 then raise exception 'Elegí al menos un producto.'; end if;
  -- La flash anterior que siga vigente o programada se cierra ahora (queda en el historial)
  update ofertas_flash set cancelada_en = now() where cancelada_en is null and termina > now();
  insert into ofertas_flash (titulo, inicia, termina) values (coalesce(nullif(btrim(p_titulo), ''), 'Ofertas flash'), p_inicia, p_termina)
  returning id into v_id;
  for it in select value from jsonb_array_elements(p_productos) loop
    i := i + 1;
    v_pid := (it->>'productId')::uuid; v_pct := (it->>'porcentaje')::integer;
    if not exists (select 1 from products where id = v_pid) then raise exception 'Producto inexistente en la oferta.'; end if;
    if v_pct is null or v_pct not between 1 and 90 then raise exception 'Cada producto necesita un descuento de 1 a 90 %%.'; end if;
    insert into ofertas_flash_productos (oferta_id, product_id, porcentaje, orden) values (v_id, v_pid, v_pct, i);
  end loop;
  perform eldo_auditar('guardar', 'ofertas_flash', v_id,
    jsonb_build_object('inicia', p_inicia, 'termina', p_termina, 'productos', jsonb_array_length(p_productos)));
  return jsonb_build_object('id', v_id);
end $$;

create function public.terminar_oferta_flash()
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  perform eldo_requiere_admin();
  update ofertas_flash set cancelada_en = now() where cancelada_en is null and termina > now();
  get diagnostics v_n = row_count;
  perform eldo_auditar('terminar', 'ofertas_flash', null, jsonb_build_object('cerradas', v_n));
  return jsonb_build_object('terminadas', v_n);
end $$;

-- -----------------------------------------------------------------------------
-- 6. LECTURA
-- -----------------------------------------------------------------------------
-- Tienda pública: todo lo vigente AHORA, solo de productos que publica catalogo_tienda().
-- Lo vencido no se envía. Incluye la hora del servidor para el temporizador.
create function public.promociones_tienda()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with ahora as (select now() as t),
  publicados as (select c.id::text as id from catalogo_tienda() c),
  flash as (
    select f.* from ofertas_flash f, ahora
     where f.inicia <= ahora.t and ahora.t < f.termina and (f.cancelada_en is null or ahora.t < f.cancelada_en)
     order by f.inicia desc limit 1)
  select jsonb_build_object(
    'ahora', (select t from ahora),
    'banners', coalesce((select jsonb_agg(jsonb_build_object('imagen', b.imagen_url, 'alt', b.texto_alt,
                  'enlaceTipo', b.enlace_tipo, 'enlace', b.enlace_valor) order by b.orden)
                from promo_banners b where b.activo and b.ubicacion = 'principal'), '[]'),
    'intermedios', coalesce((select jsonb_agg(jsonb_build_object('imagen', b.imagen_url, 'alt', b.texto_alt,
                  'enlaceTipo', b.enlace_tipo, 'enlace', b.enlace_valor) order by b.orden)
                from promo_banners b where b.activo and b.ubicacion = 'intermedio'), '[]'),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('nombre', c.nombre, 'imagen', c.imagen_url) order by c.orden, c.nombre)
                from categorias_tienda c where c.visible), '[]'),
    'ocultas', coalesce((select jsonb_agg(c.nombre) from categorias_tienda c where not c.visible), '[]'),
    'descuentos', coalesce((select jsonb_agg(jsonb_build_object('productoId', p.id, 'porcentaje', d.porcentaje,
                  'origen', d.origen, 'vence', d.vence))
                from products p cross join ahora
                cross join lateral eldo_descuento_en(p.id, ahora.t) d
                where p.id::text in (select id from publicados)), '[]'),
    'flash', (select jsonb_build_object('titulo', f.titulo, 'termina', least(f.termina, coalesce(f.cancelada_en, f.termina)),
                  'productos', coalesce((select jsonb_agg(fp.product_id order by fp.orden) from ofertas_flash_productos fp
                                          where fp.oferta_id = f.id and fp.product_id::text in (select id from publicados)), '[]'))
              from flash f)
  )
$$;

-- Panel: estado completo para administrar (solo usuarios habilitados).
-- p_en (opcional): fecha para calcular los descuentos (pedido hecho antes, hasta 7 días).
create function public.promociones_panel(p_en timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_en timestamptz := coalesce(p_en, now());
begin
  perform eldo_requiere_usuario();
  if v_en > now() + interval '5 minutes' or v_en < now() - interval '7 days' then
    raise exception 'La fecha tiene que estar entre los últimos 7 días y ahora.';
  end if;
  return jsonb_build_object(
    'ahora', now(),
    'en', v_en,
    'esAdmin', eldo_es_admin(),
    'banners', coalesce((select jsonb_agg(to_jsonb(b) order by b.ubicacion, b.orden) from promo_banners b), '[]'),
    'categorias', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('productos',
                    (select count(*) from products p where p.categoria = c.nombre)) order by c.orden, c.nombre)
                  from categorias_tienda c), '[]'),
    'descuentos', coalesce((select jsonb_agg(jsonb_build_object('productoId', p.id, 'porcentaje', d.porcentaje,
                    'origen', d.origen, 'referencia', d.referencia, 'vence', d.vence))
                  from products p cross join lateral eldo_descuento_en(p.id, v_en) d), '[]'),
    'flash', (select to_jsonb(f) || jsonb_build_object('productos', coalesce((select jsonb_agg(jsonb_build_object(
                    'productId', fp.product_id, 'porcentaje', fp.porcentaje) order by fp.orden)
                  from ofertas_flash_productos fp where fp.oferta_id = f.id), '[]'))
              from ofertas_flash f where f.cancelada_en is null and f.termina > now()
              order by f.inicia limit 1));
end $$;

-- -----------------------------------------------------------------------------
-- 7. VENTAS CON DESCUENTO
-- -----------------------------------------------------------------------------
-- Igual que register_sale_v3, pero en las líneas con "descuento" el PRECIO LO
-- CALCULA LA BASE (no se acepta el que manda el navegador):
--   precio = precio habitual × (100 − %) / 100, al peso,
-- y solo si ese descuento estaba vigente en la fecha del pedido (por defecto
-- ahora; se permite una fecha de hasta 7 días atrás, para pedidos hechos durante
-- una oferta que se registran después). El detalle queda en ventas_descuentos.
-- Cualquier usuario habilitado puede registrar ventas (como hoy).
create function public.registrar_venta_promocion(p_cliente_id uuid, p_items jsonb, p_metodo_pago text,
  p_modalidad text, p_holder_id uuid, p_fecha_pedido timestamptz default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_fecha timestamptz := coalesce(p_fecha_pedido, now()); it jsonb; nuevos jsonb := '[]';
        v_pid uuid; v_pct integer; v_hab numeric; d record; r jsonb; v_sale uuid; detalle jsonb := '[]';
begin
  perform eldo_requiere_usuario();
  if v_fecha > now() + interval '5 minutes' or v_fecha < now() - interval '7 days' then
    raise exception 'La fecha del pedido tiene que estar entre los últimos 7 días y ahora.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene productos.'; end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_pct := nullif(it #>> '{descuento,porcentaje}', '')::integer;
    if v_pct is null then
      nuevos := nuevos || jsonb_build_array(it - 'descuento');
      continue;
    end if;
    v_pid := (it->>'productoId')::uuid;
    select precio into v_hab from products where id = v_pid;
    if v_hab is null then raise exception 'Producto inexistente.'; end if;
    select * into d from eldo_descuento_en(v_pid, v_fecha);
    if d.porcentaje is null or d.porcentaje <> v_pct then
      raise exception 'El descuento de % %% ya no es válido para ese producto en la fecha del pedido. Recargá el panel.', v_pct;
    end if;
    nuevos := nuevos || jsonb_build_array((it - 'descuento') || jsonb_build_object('precioVenta', eldo_precio_con_descuento(v_hab, v_pct)));
    detalle := detalle || jsonb_build_array(jsonb_build_object('productId', v_pid, 'cantidad', (it->>'cantidad')::numeric,
      'habitual', v_hab, 'porcentaje', v_pct, 'aplicado', eldo_precio_con_descuento(v_hab, v_pct),
      'origen', d.origen, 'referencia', d.referencia));
  end loop;

  r := register_sale_v3(p_cliente_id, nuevos, p_metodo_pago, p_modalidad, p_holder_id);
  v_sale := (r->>'id')::uuid;
  insert into ventas_descuentos (sale_id, product_id, cantidad, precio_habitual, porcentaje, precio_aplicado, origen, referencia, fecha_pedido)
  select v_sale, (x->>'productId')::uuid, (x->>'cantidad')::numeric, (x->>'habitual')::numeric, (x->>'porcentaje')::integer,
         (x->>'aplicado')::numeric, x->>'origen', (x->>'referencia')::uuid, v_fecha
    from jsonb_array_elements(detalle) x;
  perform eldo_auditar('venta_con_descuento', 'sales', v_sale, jsonb_build_object('lineas', detalle, 'fecha_pedido', v_fecha));
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- 8. CARGA INICIAL: las categorías que ya usan los productos + las del panel
-- -----------------------------------------------------------------------------
insert into public.categorias_tienda (nombre, orden)
select nombre, row_number() over (order by nombre)
from (select distinct btrim(categoria) as nombre from public.products where btrim(coalesce(categoria, '')) <> ''
      union
      select unnest(array['Electrónica', 'Celulares', 'Smart TV', 'Electrodomésticos', 'Herramientas',
                          'Accesorios', 'Hogar', 'Variados'])) x
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 9. PERMISOS
-- -----------------------------------------------------------------------------
do $permisos$
declare t text; f record;
begin
  foreach t in array array['promo_banners','categorias_tienda','descuentos_producto','ofertas_flash',
                           'ofertas_flash_productos','ventas_descuentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy lectura_usuarios_habilitados on public.%I for select to authenticated using (public.eldo_es_usuario_activo())', t);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('eldo_descuento_en', 'eldo_precio_con_descuento', 'eldo_requiere_admin',
             'guardar_banner', 'ordenar_banners', 'eliminar_banner', 'guardar_categoria', 'ordenar_categorias',
             'reasignar_categoria', 'eliminar_categoria', 'poner_descuento', 'quitar_descuento',
             'guardar_oferta_flash', 'terminar_oferta_flash', 'promociones_tienda', 'promociones_panel',
             'registrar_venta_promocion') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end
$permisos$;

grant execute on function public.promociones_tienda() to anon, authenticated;
grant execute on function
  public.promociones_panel(timestamptz),
  public.guardar_banner(uuid, text, text, text, text, text, boolean),
  public.ordenar_banners(text, uuid[]),
  public.eliminar_banner(uuid),
  public.guardar_categoria(uuid, text, text, boolean),
  public.ordenar_categorias(uuid[]),
  public.reasignar_categoria(uuid, uuid),
  public.eliminar_categoria(uuid),
  public.poner_descuento(uuid, integer, timestamptz),
  public.quitar_descuento(uuid),
  public.guardar_oferta_flash(text, timestamptz, timestamptz, jsonb),
  public.terminar_oferta_flash(),
  public.registrar_venta_promocion(uuid, jsonb, text, text, uuid, timestamptz)
to authenticated;

commit;

-- Si llegaste hasta acá sin errores, la migración quedó aplicada.
select 'Migración 005 instalada correctamente' as resultado,
       (select count(*) from public.categorias_tienda) as categorias_cargadas,
       (select count(*) from public.promo_banners) as banners,
       (select count(*) from public.catalogo_tienda()) as productos_en_la_tienda;
-- FIN DEL ARCHIVO 005
