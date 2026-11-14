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

-- Caja con la estructura real de producción (migración 003): cuentas, custodios y movimientos
create table public.accounts (id uuid primary key default gen_random_uuid(), codigo text unique, nombre text, tipo text default 'negocio', activo boolean default true, creado timestamptz default now());
create table public.cash_holders (id uuid primary key default gen_random_uuid(), codigo text unique, nombre text, activo boolean default true, creado timestamptz default now());
insert into public.accounts (codigo, nombre) values ('eldostore', 'ELDOSTORE'), ('niko', 'Niko'), ('ayelen', 'Ayelen');
insert into public.cash_holders (codigo, nombre) values ('diego', 'Diego'), ('niko', 'Niko'), ('ayelen', 'Ayelen');
create function public.eldo_cuenta(p_codigo text) returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from accounts where codigo = p_codigo $$;
create function public.eldo_valida_custodio(p_holder uuid) returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_holder is null or not exists (select 1 from cash_holders where id = p_holder and activo) then
    raise exception 'Indicá quién tiene el dinero (custodio válido).';
  end if;
  return p_holder;
end $$;
create table public.cash_movements (
  id uuid primary key default gen_random_uuid(), fecha timestamptz default now(),
  tipo text not null check (tipo in ('ingreso', 'egreso')), origen text not null, monto numeric not null,
  descripcion text default '', ref_id uuid,
  account_id uuid not null references public.accounts (id) default public.eldo_cuenta('eldostore'),
  holder_id uuid not null references public.cash_holders (id), creado_por uuid default auth.uid(),
  anula_a uuid references public.cash_movements (id));
-- Movimientos anteriores (ventas propias): no se tienen que modificar
insert into public.cash_movements (tipo, origen, monto, descripcion, ref_id, holder_id)
select 'ingreso', 'venta', 30000, 'Venta', gen_random_uuid(), id from public.cash_holders where codigo = 'diego';
insert into public.cash_movements (tipo, origen, monto, descripcion, ref_id, holder_id)
select 'egreso', 'comision_revendedor', 3000, 'Comisión de revendedor', gen_random_uuid(), id from public.cash_holders where codigo = 'diego';

-- Diego (administrador) y Niko (usuario activo, no administrador)
insert into public.app_users values
  ('11111111-1111-1111-1111-111111111111', (select id from public.cash_holders where codigo = 'diego'), 'Diego', true, true),
  ('22222222-2222-2222-2222-222222222222', (select id from public.cash_holders where codigo = 'niko'), 'Niko', true, false);

-- Permisos de funciones IGUALES a producción (migración 003): se revocó todo a public/anon/authenticated
-- y solo se devolvió eldo_es_usuario_activo() a authenticated. (Sin esto, la prueba no detectaba
-- que una política que llama a eldo_es_admin() falla para los usuarios autenticados.)
revoke all on function public.eldo_es_admin(), public.eldo_es_usuario_activo(), public.eldo_requiere_usuario(),
  public.eldo_auditar(text, text, uuid, jsonb), public.eldo_cuenta(text), public.eldo_valida_custodio(uuid)
  from public, anon, authenticated;
grant execute on function public.eldo_es_usuario_activo() to authenticated;
