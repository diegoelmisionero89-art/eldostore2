-- Base mínima que imita lo que la migración 006 usa de producción (solo para pruebas locales).
-- Roles de Supabase, auth.uid() leído de una variable de sesión, y las funciones de la 003.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create table public.app_users (user_id uuid primary key, holder_id uuid, nombre text, activo boolean, es_admin boolean);
create table public.audit_log (id bigserial primary key, fecha timestamptz default now(), usuario uuid default auth.uid(),
  accion text, tabla text, registro uuid, detalle jsonb default '{}');
create table public.products (id uuid primary key default gen_random_uuid(), codigo text, nombre text, categoria text,
  precio numeric, stock integer, foto text, activo boolean default true);
insert into public.products (codigo, nombre, categoria, precio, stock) values ('001', 'Auricular propio', 'Audio', 15000, 3);

create function public.eldo_es_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app_users where user_id = auth.uid() and activo and es_admin) $$;
create function public.eldo_es_usuario_activo() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app_users where user_id = auth.uid() and activo) $$;
create function public.eldo_requiere_usuario() returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_holder uuid;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión para operar.'; end if;
  select holder_id into v_holder from app_users where user_id = auth.uid() and activo;
  if v_holder is null then raise exception 'Tu usuario no está habilitado en el panel de ELDOSTORE.'; end if;
  return v_holder;
end $$;
create function public.eldo_auditar(p_accion text, p_tabla text, p_registro uuid, p_detalle jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into audit_log (accion, tabla, registro, detalle) values (p_accion, p_tabla, p_registro, coalesce(p_detalle, '{}')) $$;
create function public.catalogo_tienda() returns table(id uuid, codigo text, nombre text, categoria text, precio numeric, foto text, disponible boolean)
language sql security definer set search_path = '' as $$
  select p.id, p.codigo, p.nombre, p.categoria, p.precio, p.foto, (p.stock > 0) from public.products p where p.activo order by p.nombre $$;
grant execute on function public.catalogo_tienda() to anon, authenticated;

-- Diego (administrador) y Niko (usuario activo, no administrador)
insert into public.app_users values
  ('11111111-1111-1111-1111-111111111111', gen_random_uuid(), 'Diego', true, true),
  ('22222222-2222-2222-2222-222222222222', gen_random_uuid(), 'Niko', true, false);
