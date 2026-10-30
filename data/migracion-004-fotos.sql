-- =============================================================================
-- ELDOSTORE — Migración 004: varias fotos por producto (galería de la ficha)
--
-- Qué hace (solo agrega; no modifica datos existentes):
--   * Tabla nueva public.product_fotos: fotos ADICIONALES de cada producto.
--     La foto principal sigue siendo products.foto, como hasta ahora.
--   * Función nueva public.fotos_tienda(): la tienda pública lee las fotos
--     adicionales SOLO de los productos que ya publica catalogo_tienda().
--   * No modifica products (precios, costos, stock, códigos), ni catalogo_tienda(),
--     ni el bucket de Storage "productos-fotos" (se sigue usando el mismo).
--
-- Seguridad:
--   * Solo los usuarios habilitados del panel (V003) pueden agregar, ordenar o
--     quitar fotos. La tienda (anon) solo puede leerlas con fotos_tienda().
--   * Una sola transacción: si algo no coincide, se detiene y no cambia nada.
--   * Requiere la migración 003 (tres cuentas) ya instalada.
--
-- Cómo correrla: SQL Editor → pegar TODO → bajar hasta el final y comprobar que
-- la última línea sea  -- FIN DEL ARCHIVO 004  → Run.
-- Reversión: data/migracion-004-revertir.sql
-- =============================================================================
begin;

do $verificar$
begin
  if to_regclass('public.product_fotos') is not null then
    raise exception 'La migración 004 ya está aplicada (existe product_fotos). No se hizo ningún cambio.';
  end if;
  if to_regprocedure('public.eldo_es_usuario_activo()') is null then
    raise exception 'Falta la migración 003 (no existe eldo_es_usuario_activo). No se hizo ningún cambio.';
  end if;
  if to_regprocedure('public.catalogo_tienda()') is null then
    raise exception 'No existe catalogo_tienda(). No se hizo ningún cambio.';
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'products' and column_name = 'id') <> 'uuid' then
    raise exception 'products.id no es uuid. No se hizo ningún cambio.';
  end if;
  -- catalogo_tienda() tiene que devolver la columna id (la tienda la usa para unir las fotos)
  begin
    perform c.id from public.catalogo_tienda() c limit 1;
  exception when undefined_column then
    raise exception 'catalogo_tienda() no devuelve la columna id. No se hizo ningún cambio.';
  end;
end
$verificar$;

create table public.product_fotos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  url text not null check (url ~ '^https://[^[:space:]"''<>]+$' and length(url) <= 1000),
  orden integer not null default 0,
  creado timestamptz not null default now(),
  creado_por uuid default auth.uid()
);
create index product_fotos_producto_idx on public.product_fotos (product_id, orden);

alter table public.product_fotos enable row level security;
revoke all on public.product_fotos from anon, authenticated;
grant select, insert, update, delete on public.product_fotos to authenticated;
create policy fotos_usuarios_habilitados on public.product_fotos
  for all to authenticated
  using (public.eldo_es_usuario_activo())
  with check (public.eldo_es_usuario_activo());

-- Lectura pública: solo fotos de productos que la tienda ya publica.
create function public.fotos_tienda()
returns table (producto_id uuid, url text, orden integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select f.product_id, f.url, f.orden
  from product_fotos f
  where f.product_id::text in (select c.id::text from catalogo_tienda() c)
  order by f.product_id, f.orden, f.creado
$$;
revoke all on function public.fotos_tienda() from public;
grant execute on function public.fotos_tienda() to anon, authenticated;

commit;

-- Si llegaste hasta acá sin errores, la migración quedó aplicada.
select 'Migración 004 instalada correctamente' as resultado,
       (select count(*) from public.fotos_tienda()) as fotos_adicionales,
       (select count(*) from public.catalogo_tienda()) as productos_en_la_tienda;
-- FIN DEL ARCHIVO 004
