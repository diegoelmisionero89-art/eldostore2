-- =============================================================================
-- ENTORNO LOCAL DE PRUEBA — NO ES EL SQL REAL DE ELDOSTORE
--
-- Imita lo que el código del panel confirma (tablas y columnas que usa js/db.js)
-- y lo que hace Supabase (roles, auth.uid(), storage). Los TIPOS son supuestos.
-- Solo sirve para probar la migración 003 en una base PostgreSQL vacía.
--
-- NUNCA correr en Supabase ni en ninguna base con datos reales.
-- =============================================================================
do $$ begin
  if current_database() <> 'eldo_prueba_local' then
    raise exception 'Este script solo se ejecuta en la base local "eldo_prueba_local".';
  end if;
  if to_regclass('public.products') is not null then
    raise exception 'La base ya tiene tablas: este script es solo para una base vacía.';
  end if;
end $$;

-- Roles y Auth como en Supabase
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
insert into storage.buckets values ('productos-fotos', 'productos-fotos', true);

-- Tablas (columnas confirmadas por js/db.js; tipos supuestos)
create table products (
  id uuid primary key default gen_random_uuid(), codigo text unique not null, nombre text not null,
  categoria text default '', costo numeric default 0, precio numeric default 0, stock integer default 0,
  stock_min integer default 0, foto text default '', activo boolean default true, revisar boolean default false,
  creado timestamptz default now());
create table clients (
  id uuid primary key default gen_random_uuid(), nombre text, telefono text, localidad text, direccion text,
  notas text, fecha_alta timestamptz default now());
create table sales (
  id uuid primary key default gen_random_uuid(), fecha timestamptz default now(), cliente_id uuid references clients,
  items jsonb not null default '[]', total numeric not null default 0, costo_total numeric not null default 0,
  ganancia numeric not null default 0, metodo_pago text default '', pedido_id uuid, modalidad text default 'propia',
  comision_total numeric default 0, anulada boolean default false, anulada_el timestamptz, motivo_anulacion text,
  corrige_a uuid references sales);
create table orders (
  id uuid primary key default gen_random_uuid(), cliente_id uuid references clients, items jsonb default '[]',
  total numeric default 0, sena numeric default 0, saldo numeric default 0, metodo_pago text default '',
  envio_o_retiro text default 'Retiro', direccion text default '', notas text default '',
  fecha timestamptz default now(), estado text default 'Pendiente', venta_id uuid references sales);
create table purchases (
  id uuid primary key default gen_random_uuid(), fecha timestamptz default now(), proveedor text default '',
  producto_id uuid references products, cantidad integer not null, costo_unit numeric not null, total numeric not null,
  metodo_pago text default '', notas text default '', anulada boolean default false, anulada_el timestamptz,
  motivo_anulacion text, corrige_a uuid references purchases);
create table expenses (
  id uuid primary key default gen_random_uuid(), fecha timestamptz default now(), descripcion text not null,
  categoria text default 'General', importe numeric not null, metodo_pago text default '', notas text default '',
  anulada boolean default false, anulada_el timestamptz, motivo_anulacion text, corrige_a uuid references expenses);
create table cash_movements (
  id uuid primary key default gen_random_uuid(), fecha timestamptz default now(), tipo text not null,
  origen text default 'otro', monto numeric not null, descripcion text default '', ref_id uuid);
create table shipments (
  id uuid primary key default gen_random_uuid(), cliente_id uuid, direccion text, localidad text, pedido_id uuid,
  costo_envio numeric default 0, estado text default 'Pendiente', fecha timestamptz default now(), observaciones text);
create table app_config (
  id int primary key, shipping_rates jsonb, free_shipping_from numeric, next_code_number int,
  inventario_real_cargado boolean, updated_at timestamptz);

-- Seguridad parecida a la habitual en Supabase: RLS activo, acceso total para "authenticated"
do $$ declare t text; begin
  foreach t in array array['products','clients','sales','orders','purchases','expenses','cash_movements','shipments','app_config'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy acceso_autenticado on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

insert into app_config values (1, '[{"min":1,"max":5,"costo":1500},{"min":6,"max":11,"costo":2000},{"min":12,"max":18,"costo":3000}]', 50000, 200, true, now());
