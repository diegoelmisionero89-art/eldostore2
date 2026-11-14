-- Base DESCARTABLE que reproduce lo que la migración 007 toca en producción (solo para pruebas locales).
-- Copia exacta (relevada el 14/11/2026, solo lectura) de:
--   * public.products: columnas, permisos (anon y authenticated con todos los privilegios), RLS y sus 4 políticas
--   * storage.objects: dueño supabase_storage_admin, permisos y las 3 políticas eldostore_fotos_*
--   * auth.uid() / auth.role() como los define Supabase (leen el JWT de la sesión)
--   * eldo_es_usuario_activo(), eldo_es_admin(), eldo_requiere_usuario() y sus permisos (003)
--   * catalogo_tienda() (definición real), una tabla interna con la política restrictiva de la 003 (sales)
--     y una función SECURITY DEFINER del panel que modifica products (como adjust_stock_v3).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then create role supabase_storage_admin nologin noinherit; end if;
end $$;

-- ---------- auth (como Supabase) ----------
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Diego (administrador), Niko (usuario activo), Ayelen (cuenta de Auth vinculada pero INACTIVA)
-- y «externo» (se registró solo en Auth, no está en el panel).
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'diego@prueba'),
  ('22222222-2222-2222-2222-222222222222', 'niko@prueba'),
  ('33333333-3333-3333-3333-333333333333', 'ayelen@prueba'),
  ('99999999-9999-4999-8999-999999999999', 'externo@prueba');

-- ---------- public ----------
create table public.app_users (user_id uuid primary key, holder_id uuid, nombre text, activo boolean, es_admin boolean);
insert into public.app_users values
  ('11111111-1111-1111-1111-111111111111', null, 'diego@prueba', true, true),
  ('22222222-2222-2222-2222-222222222222', null, 'niko@prueba', true, false),
  ('33333333-3333-3333-3333-333333333333', null, 'ayelen@prueba', false, false);
alter table public.app_users enable row level security;

create function public.eldo_es_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app_users where user_id = auth.uid() and activo and es_admin) $$;
create function public.eldo_es_usuario_activo() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app_users where user_id = auth.uid() and activo) $$;
create policy lectura_usuarios_habilitados on public.app_users for select to authenticated using (public.eldo_es_usuario_activo());
grant select on public.app_users to authenticated;

-- products: columnas reales de producción
create table public.products (
  id uuid primary key default gen_random_uuid(), codigo text unique, nombre text, categoria text,
  costo numeric, precio numeric, stock numeric, stock_min numeric, foto text, activo boolean default true,
  revisar boolean default false, creado timestamptz default now(), owner_account_id uuid);
insert into public.products (codigo, nombre, categoria, costo, precio, stock, stock_min, foto, activo) values
  ('001', 'Auricular', 'Audio', 9000, 15000, 3, 1, 'https://x/a.jpg', true),
  ('002', 'Cargador', 'Accesorios', 4000, 8000, 0, 1, 'https://x/b.jpg', true),
  ('003', 'Parlante', 'Audio', 20000, 35000, 5, 1, 'https://x/c.jpg', true),
  ('004', 'Producto inactivo', 'Audio', 1000, 2000, 2, 1, '', false);
alter table public.products enable row level security;
-- Permisos IGUALES a producción: anon y authenticated tienen todos los privilegios de tabla; los limita RLS.
grant all on public.products to anon, authenticated, service_role;
-- Políticas IGUALES a producción
create policy acceso_autenticados on public.products for all to public
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy eldo003_alta_habilitados on public.products as restrictive for insert to authenticated with check (public.eldo_es_usuario_activo());
create policy eldo003_cambio_habilitados on public.products as restrictive for update to authenticated using (public.eldo_es_usuario_activo()) with check (public.eldo_es_usuario_activo());
create policy eldo003_baja_habilitados on public.products as restrictive for delete to authenticated using (public.eldo_es_usuario_activo());

-- Tabla interna con el patrón completo de la 003 (para comprobar que nada más cambia)
create table public.sales (id uuid primary key default gen_random_uuid(), total numeric);
insert into public.sales (total) values (15000), (8000);
alter table public.sales enable row level security;
grant all on public.sales to anon, authenticated, service_role;
create policy acceso_autenticados on public.sales for all to public
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy eldo003_lectura_habilitados on public.sales as restrictive for select to authenticated using (public.eldo_es_usuario_activo());
create policy eldo003_alta_habilitados on public.sales as restrictive for insert to authenticated with check (public.eldo_es_usuario_activo());

-- catalogo_tienda(): definición REAL de producción
CREATE OR REPLACE FUNCTION public.catalogo_tienda()
 RETURNS TABLE(id uuid, codigo text, nombre text, categoria text, precio numeric, foto text, disponible boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.id, p.codigo, p.nombre, p.categoria, p.precio, p.foto, (p.stock > 0) AS disponible
  FROM public.products AS p
  WHERE p.activo = true
  ORDER BY p.nombre;
$function$;

-- Función del panel que modifica products con SECURITY DEFINER (como adjust_stock_v3)
create function public.eldo_requiere_usuario() returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not eldo_es_usuario_activo() then raise exception 'Tu usuario no está habilitado en el panel de ELDOSTORE.'; end if;
end $$;
create function public.ajustar_stock_prueba(p_codigo text, p_delta numeric) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare v numeric;
begin
  perform eldo_requiere_usuario();
  update products set stock = stock + p_delta where codigo = p_codigo returning stock into v;
  return v;
end $$;

-- Permisos de funciones IGUALES a producción (003): eldo_es_admin NO es ejecutable por authenticated
revoke all on function public.eldo_es_admin(), public.eldo_es_usuario_activo(), public.eldo_requiere_usuario(),
  public.ajustar_stock_prueba(text, numeric) from public, anon, authenticated;
grant execute on function public.eldo_es_usuario_activo() to authenticated;
grant execute on function public.ajustar_stock_prueba(text, numeric) to authenticated;
grant execute on function public.catalogo_tienda() to anon, authenticated;

-- ---------- storage (como Supabase) ----------
create schema storage;
alter schema storage owner to supabase_storage_admin;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text,
  owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
insert into storage.buckets values ('productos-fotos', 'productos-fotos', true), ('otro-bucket', 'otro-bucket', false);
insert into storage.objects (bucket_id, name) values
  ('productos-fotos', 'optimizadas/productos/foto-real-1.webp'),
  ('productos-fotos', 'banners/banner-real.webp'),
  ('productos-fotos', 'categorias/cat-real.webp');
alter table storage.objects enable row level security;
-- Permisos IGUALES a producción
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant all on storage.objects to service_role;
grant select on storage.buckets to anon, authenticated;
-- Políticas IGUALES a producción
create policy eldostore_fotos_subir on storage.objects for insert to authenticated with check (bucket_id = 'productos-fotos');
create policy eldostore_fotos_actualizar on storage.objects for update to authenticated
  using (bucket_id = 'productos-fotos') with check (bucket_id = 'productos-fotos');
create policy eldostore_fotos_borrar on storage.objects for delete to authenticated using (bucket_id = 'productos-fotos');
