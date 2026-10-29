-- =============================================================================
-- ELDOSTORE — Migración 003: tres cuentas (ELDOSTORE, Niko, Ayelen)
-- Versión de PRUEBA · 29/10/2026 · Rama cuentas-v003
--
-- CORRER PRIMERO EN UN PROYECTO SUPABASE DE PRUEBAS. NUNCA directamente en producción.
--
-- Qué hace:
--   * Agrega cuentas, custodios (quién tiene el dinero) y usuarios del panel.
--   * Agrega columnas de cuenta / custodio / usuario a tablas existentes, con valores
--     por defecto seguros: todo lo existente queda en ELDOSTORE con custodio Diego.
--   * Crea funciones v3 NUEVAS. NO modifica ni reemplaza ninguna función existente:
--     cuando hace falta, las v3 LLAMAN a las funciones actuales (void_sale,
--     register_purchase, void_purchase, void_expense) y asignan sus movimientos con
--     un contexto de transacción (eldo.account_id / eldo.holder_id).
--   * No borra ni reescribe datos históricos (solo completa columnas nuevas).
--
-- Seguridad:
--   * Va en UNA transacción: si algo falla, no se aplica nada.
--   * Antes de cambiar nada, el paso 0 verifica que la base real tenga la estructura
--     que el código supone (tablas, columnas, tipos, funciones y parámetros) y prueba,
--     sin dejar datos, que las tablas acepten las filas que se van a insertar.
--     Si algo no coincide, se detiene con un mensaje claro.
--
-- Accesos (corrección de seguridad, revisión ChatGPT):
--   * Solo queda habilitado el ADMINISTRADOR (Diego), identificado por su email de
--     Supabase Auth, que se escribe abajo (paso "ANTES DE CORRER"). Nadie más queda
--     habilitado automáticamente: Niko y Ayelen quedan pendientes hasta que Diego
--     los autorice desde Configuración → Usuarios del panel.
--   * Solo el administrador puede vincular, activar, desactivar o cambiar el custodio
--     de otros usuarios. Ningún usuario puede darse permisos de administrador.
--   * Las tablas existentes reciben políticas RESTRICTIVAS adicionales: solo usuarios
--     habilitados pueden leer o escribir datos internos. Las políticas actuales no se
--     reemplazan. La tienda pública (catalogo_tienda y lectura de productos) no cambia.
--   * Las funciones actuales que modifican datos (v2) dejan de poder ejecutarse
--     directamente desde el navegador; el panel nuevo usa las v3, que las llaman por
--     dentro. Los permisos originales se guardan para la reversión.
--
-- Cómo correrla (proyecto de pruebas): SQL Editor → pegar TODO el archivo → Run.
-- Antes y después: Q2 de CONSULTAS-SOLO-LECTURA-ELDOSTORE.sql (tiene que dar igual).
-- Reversión: data/migracion-003-revertir.sql
-- =============================================================================

begin;

-- ===================== ANTES DE CORRER =====================================
-- Reemplazá EMAIL_DEL_ADMINISTRADOR por el email EXACTO con el que Diego entra al
-- panel (Supabase → Authentication → Users). Si no coincide con un usuario
-- existente, la migración se detiene sin cambiar nada.
select set_config('eldo.admin_email', 'EMAIL_DEL_ADMINISTRADOR', true);
-- ===========================================================================

do $admin$
declare v_email text := lower(trim(current_setting('eldo.admin_email', true))); n int;
begin
  if v_email is null or v_email = '' or v_email = lower('EMAIL_DEL_ADMINISTRADOR') then
    raise exception 'Falta indicar el email del administrador (línea "ANTES DE CORRER"). No se hizo ningún cambio.';
  end if;
  select count(*) into n from auth.users where lower(email) = v_email;
  if n <> 1 then
    raise exception 'El email del administrador no corresponde a un único usuario de Supabase Auth (encontrados: %). No se hizo ningún cambio.', n;
  end if;
end
$admin$;

-- -----------------------------------------------------------------------------
-- 0. VERIFICACIONES (no cambian nada; abortan si la base no es la esperada)
-- -----------------------------------------------------------------------------
do $verificar$
declare
  faltan text[] := '{}';
  r record;
  req jsonb := '{
    "products":       ["id","codigo","nombre","categoria","costo","precio","stock","activo"],
    "sales":          ["id","fecha","cliente_id","items","total","costo_total","ganancia","metodo_pago","pedido_id","modalidad","comision_total","anulada","anulada_el","motivo_anulacion","corrige_a"],
    "purchases":      ["id","fecha","producto_id","cantidad","costo_unit","total","anulada","corrige_a"],
    "expenses":       ["id","fecha","descripcion","categoria","importe","metodo_pago","notas","anulada","anulada_el","motivo_anulacion","corrige_a"],
    "cash_movements": ["id","fecha","tipo","origen","monto","descripcion","ref_id"],
    "orders":         ["id","cliente_id","items","estado","venta_id","metodo_pago"],
    "clients":        ["id"]
  }';
  t text; c text; tipo text;
begin
  if to_regclass('public.accounts') is not null then
    raise exception 'La migración 003 ya está aplicada (existe la tabla accounts). No se hizo ningún cambio.';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'No existe auth.uid(): esta base no parece un proyecto Supabase.';
  end if;

  -- Tablas y columnas que usa el código
  for t in select jsonb_object_keys(req) loop
    if to_regclass('public.' || t) is null then
      faltan := faltan || ('tabla ' || t);
      continue;
    end if;
    for c in select jsonb_array_elements_text(req -> t) loop
      if not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = t and column_name = c) then
        faltan := faltan || (t || '.' || c);
      end if;
    end loop;
  end loop;
  if array_length(faltan, 1) > 0 then
    raise exception 'Faltan tablas o columnas esperadas: %. No se hizo ningún cambio.', array_to_string(faltan, ', ');
  end if;

  -- Tipos de los que dependen las funciones v3
  for r in select table_name, column_name, data_type from information_schema.columns
           where table_schema = 'public' and (
             (column_name = 'id' and table_name in ('products','sales','purchases','expenses','cash_movements','orders','clients'))
             or (table_name in ('sales','orders') and column_name = 'items')
             or (column_name = 'fecha' and table_name in ('sales','purchases','expenses','cash_movements'))
             or (table_name = 'cash_movements' and column_name = 'ref_id')
             or (table_name = 'products' and column_name in ('stock','costo','precio'))) loop
    tipo := r.data_type;
    if (r.column_name in ('id','ref_id') and tipo <> 'uuid')
       or (r.column_name = 'items' and tipo not in ('json','jsonb'))
       or (r.column_name = 'fecha' and tipo not like 'timestamp%' and tipo <> 'date')
       or (r.column_name in ('stock','costo','precio') and tipo not in ('integer','bigint','smallint','numeric','real','double precision')) then
      raise exception 'Tipo inesperado en %.%: %. No se hizo ningún cambio.', r.table_name, r.column_name, tipo;
    end if;
  end loop;

  -- Los id se generan solos (la migración inserta sin indicar id)
  for r in select table_name from information_schema.columns
           where table_schema = 'public' and column_name = 'id' and column_default is null
             and table_name in ('sales','purchases','expenses','cash_movements') loop
    raise exception 'La columna %.id no tiene valor por defecto. No se hizo ningún cambio.', r.table_name;
  end loop;

  -- Funciones actuales que las v3 llaman (nombre y parámetros exactos)
  for r in select * from (values
      ('void_sale',         array['p_sale_id','p_motivo']),
      ('register_purchase', array['p_proveedor','p_producto_id','p_cantidad','p_costo_unit','p_metodo_pago','p_notas']),
      ('void_purchase',     array['p_purchase_id','p_motivo']),
      ('void_expense',      array['p_expense_id','p_motivo'])) f(nombre, args) loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = r.nombre
                     and p.proargnames[1:array_length(r.args, 1)] = r.args) then
      raise exception 'No se encontró la función %(%) con esos parámetros. No se hizo ningún cambio.',
        r.nombre, array_to_string(r.args, ', ');
    end if;
  end loop;

  -- Nombres que la migración va a crear no deben existir
  for r in select unnest(array['cash_holders','app_users','sale_allocations','expense_allocations',
                               'account_transfers','stock_adjustments','audit_log','eldo_003_permisos_originales']) as n loop
    if to_regclass('public.' || r.n) is not null then
      raise exception 'Ya existe la tabla %. No se hizo ningún cambio.', r.n;
    end if;
  end loop;
  for r in select table_name, column_name from information_schema.columns
           where table_schema = 'public' and (table_name, column_name) in (
             ('products','owner_account_id'), ('sales','holder_id'), ('sales','creado_por'), ('sales','anulado_por'),
             ('purchases','account_id'), ('purchases','holder_id'), ('purchases','creado_por'), ('purchases','anulado_por'),
             ('purchases','registrado_en'), ('expenses','holder_id'), ('expenses','creado_por'), ('expenses','anulado_por'),
             ('cash_movements','account_id'), ('cash_movements','holder_id'), ('cash_movements','creado_por'),
             ('cash_movements','anula_a')) loop
    raise exception 'Ya existe la columna %.%. No se hizo ningún cambio.', r.table_name, r.column_name;
  end loop;
end
$verificar$;

-- Prueba de compatibilidad SIN dejar datos: cada inserción se deshace en el acto.
-- Detecta restricciones desconocidas (CHECK, NOT NULL) antes de cambiar nada.
do $compatibilidad$
declare v text; marca constant text := '__eldo003_prueba_sin_datos__';
begin
  foreach v in array array['venta','comision_revendedor','compra','gasto','liquidacion','reparto','retiro','aporte','apertura'] loop
    begin
      insert into public.cash_movements (tipo, origen, monto, descripcion) values ('ingreso', v, 1, marca);
      insert into public.cash_movements (tipo, origen, monto, descripcion) values ('egreso', v, 1, marca);
      raise exception using message = marca;
    exception when others then
      if sqlerrm <> marca then
        raise exception 'cash_movements no acepta origen "%": %. No se hizo ningún cambio.', v, sqlerrm;
      end if;
    end;
  end loop;
  begin
    insert into public.sales (items, total, costo_total, ganancia, metodo_pago, modalidad, comision_total)
    values ('[]', 0, 0, 0, '', 'revendedor', 0);
    raise exception using message = marca;
  exception when others then
    if sqlerrm <> marca then raise exception 'sales no acepta una venta mínima: %. No se hizo ningún cambio.', sqlerrm; end if;
  end;
  begin
    insert into public.expenses (descripcion, categoria, importe, metodo_pago, notas) values (marca, 'General', 1, '', '');
    raise exception using message = marca;
  exception when others then
    if sqlerrm <> marca then raise exception 'expenses no acepta un gasto mínimo: %. No se hizo ningún cambio.', sqlerrm; end if;
  end;
end
$compatibilidad$;

-- -----------------------------------------------------------------------------
-- 1. CUENTAS, CUSTODIOS Y USUARIOS
-- -----------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z_]+$'),
  nombre text not null,
  tipo text not null check (tipo in ('negocio', 'personal')),
  activo boolean not null default true,
  creado timestamptz not null default now()
);
insert into public.accounts (codigo, nombre, tipo) values
  ('eldostore', 'ELDOSTORE', 'negocio'),
  ('niko', 'Niko', 'personal'),
  ('ayelen', 'Ayelen', 'personal');

-- Custodios: la persona que tiene el dinero (cobró o pagó). Decisión D1: por persona.
create table public.cash_holders (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z_]+$'),
  nombre text not null,
  activo boolean not null default true,
  creado timestamptz not null default now()
);
insert into public.cash_holders (codigo, nombre) values
  ('diego', 'Diego (ELDOSTORE)'), ('niko', 'Niko'), ('ayelen', 'Ayelen');

-- Usuarios autorizados del panel. Solo ellos pueden usar las funciones v3.
create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  holder_id uuid not null references public.cash_holders (id),
  nombre text not null default '',
  activo boolean not null default true,
  es_admin boolean not null default false,
  creado timestamptz not null default now(),
  check (not es_admin or activo)
);
-- Un solo administrador.
create unique index app_users_un_admin on public.app_users ((true)) where es_admin;
-- Solo el administrador (Diego) queda habilitado. El resto de los usuarios de Auth
-- NO se habilita: Diego los autoriza después desde el panel.
insert into public.app_users (user_id, holder_id, nombre, activo, es_admin)
select u.id, (select id from public.cash_holders where codigo = 'diego'), coalesce(u.email, ''), true, true
from auth.users u where lower(u.email) = lower(trim(current_setting('eldo.admin_email', true)));

-- -----------------------------------------------------------------------------
-- 2. FUNCIONES AUXILIARES (contexto y control de acceso)
-- -----------------------------------------------------------------------------
create function public.eldo_cuenta(p_codigo text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from accounts where codigo = p_codigo
$$;
create function public.eldo_custodio(p_codigo text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from cash_holders where codigo = p_codigo
$$;

-- Valores por defecto según el contexto de la transacción. Fuera de una función
-- v3 (panel viejo, funciones v2 solas) el contexto está vacío → ELDOSTORE / Diego.
create function public.eldo_ctx_account() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(current_setting('eldo.account_id', true), '')::uuid,
                  (select id from accounts where codigo = 'eldostore'))
$$;
create function public.eldo_ctx_holder() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(current_setting('eldo.holder_id', true), '')::uuid,
                  (select id from cash_holders where codigo = 'diego'))
$$;

create function public.eldo_es_usuario_activo() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app_users where user_id = auth.uid() and activo)
$$;

create function public.eldo_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app_users where user_id = auth.uid() and activo and es_admin)
$$;

-- Devuelve el custodio del usuario actual o detiene la operación.
create function public.eldo_requiere_usuario() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_holder uuid;
begin
  if auth.uid() is null then
    raise exception 'Iniciá sesión para operar.';
  end if;
  select holder_id into v_holder from app_users where user_id = auth.uid() and activo;
  if v_holder is null then
    raise exception 'Tu usuario no está habilitado en el panel de ELDOSTORE.';
  end if;
  return v_holder;
end $$;

create function public.eldo_valida_custodio(p_holder uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_holder is null or not exists (select 1 from cash_holders where id = p_holder and activo) then
    raise exception 'Indicá quién tiene el dinero (custodio válido).';
  end if;
  return p_holder;
end $$;

create function public.eldo_valida_cuenta(p_account uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_account is null or not exists (select 1 from accounts where id = p_account and activo) then
    raise exception 'Cuenta inválida.';
  end if;
  return p_account;
end $$;

-- ¿La función actual devuelve json/jsonb? (el panel no usa el resultado de algunas,
-- así que su tipo no está confirmado: se consulta en el momento y se llama según corresponda)
create function public._eldo3_devuelve_json(p_nombre text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = p_nombre
                   and format_type(p.prorettype, null) in ('json', 'jsonb'))
$$;

create function public.eldo_set_ctx(p_account uuid, p_holder uuid) returns void
language sql volatile set search_path = public, pg_temp as $$
  select set_config('eldo.account_id', coalesce(p_account::text, ''), true),
         set_config('eldo.holder_id', coalesce(p_holder::text, ''), true);
$$;

-- -----------------------------------------------------------------------------
-- 3. COLUMNAS NUEVAS EN TABLAS EXISTENTES (sin reescribir datos históricos)
-- -----------------------------------------------------------------------------
alter table public.products add column owner_account_id uuid references public.accounts (id);
update public.products set owner_account_id = public.eldo_cuenta('eldostore');
alter table public.products alter column owner_account_id set default public.eldo_ctx_account();
alter table public.products alter column owner_account_id set not null;

alter table public.sales
  add column holder_id uuid references public.cash_holders (id),
  add column creado_por uuid,
  add column anulado_por uuid;
update public.sales set holder_id = public.eldo_custodio('diego');
alter table public.sales alter column holder_id set default public.eldo_ctx_holder();
alter table public.sales alter column holder_id set not null;
alter table public.sales alter column creado_por set default auth.uid();

alter table public.purchases
  add column account_id uuid references public.accounts (id),
  add column holder_id uuid references public.cash_holders (id),
  add column creado_por uuid,
  add column anulado_por uuid,
  add column registrado_en timestamptz;
update public.purchases set account_id = public.eldo_cuenta('eldostore'), holder_id = public.eldo_custodio('diego');
alter table public.purchases alter column account_id set default public.eldo_ctx_account();
alter table public.purchases alter column holder_id set default public.eldo_ctx_holder();
alter table public.purchases alter column account_id set not null;
alter table public.purchases alter column holder_id set not null;
alter table public.purchases alter column creado_por set default auth.uid();
alter table public.purchases alter column registrado_en set default clock_timestamp();

alter table public.expenses
  add column holder_id uuid references public.cash_holders (id),
  add column creado_por uuid,
  add column anulado_por uuid;
update public.expenses set holder_id = public.eldo_custodio('diego');
alter table public.expenses alter column holder_id set default public.eldo_ctx_holder();
alter table public.expenses alter column holder_id set not null;
alter table public.expenses alter column creado_por set default auth.uid();

alter table public.cash_movements
  add column account_id uuid references public.accounts (id),
  add column holder_id uuid references public.cash_holders (id),
  add column creado_por uuid,
  add column anula_a uuid references public.cash_movements (id);
update public.cash_movements set account_id = public.eldo_cuenta('eldostore'), holder_id = public.eldo_custodio('diego');
alter table public.cash_movements alter column account_id set default public.eldo_ctx_account();
alter table public.cash_movements alter column holder_id set default public.eldo_ctx_holder();
alter table public.cash_movements alter column account_id set not null;
alter table public.cash_movements alter column holder_id set not null;
alter table public.cash_movements alter column creado_por set default auth.uid();

create index on public.cash_movements (ref_id);
create index on public.cash_movements (account_id, holder_id);

-- -----------------------------------------------------------------------------
-- 4. TABLAS NUEVAS
-- -----------------------------------------------------------------------------
-- Reparto de cada venta por cuenta. Lo escriben solo las funciones.
create table public.sale_allocations (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales (id),
  account_id uuid not null references public.accounts (id),
  total numeric not null default 0,
  costo numeric not null default 0,
  comision numeric not null default 0,
  ganancia numeric not null default 0,
  anulada boolean not null default false,
  origen text not null check (origen in ('v3', 'historico')),
  unique (sale_id, account_id)
);
insert into public.sale_allocations (sale_id, account_id, total, costo, comision, ganancia, anulada, origen)
select s.id, public.eldo_cuenta('eldostore'), coalesce(s.total, 0), coalesce(s.costo_total, 0),
       coalesce(s.comision_total, 0), coalesce(s.ganancia, 0), coalesce(s.anulada, false), 'historico'
from public.sales s;

-- Partes de cada gasto (gastos compartidos con reparto manual).
create table public.expense_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id),
  account_id uuid not null references public.accounts (id),
  importe numeric not null check (importe >= 0),
  origen text not null check (origen in ('v3', 'historico')),
  unique (expense_id, account_id)
);
insert into public.expense_allocations (expense_id, account_id, importe, origen)
select e.id, public.eldo_cuenta('eldostore'), coalesce(e.importe, 0), 'historico'
from public.expenses e;

-- Movimientos entre cuentas y custodios: liquidaciones, repartos, retiros, aportes, apertura.
create table public.account_transfers (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  tipo text not null check (tipo in ('liquidacion', 'reparto', 'retiro', 'aporte', 'apertura')),
  from_account_id uuid references public.accounts (id),
  from_holder_id uuid references public.cash_holders (id),
  to_account_id uuid references public.accounts (id),
  to_holder_id uuid references public.cash_holders (id),
  monto numeric not null check (monto > 0),
  motivo text not null default '',
  creado_por uuid default auth.uid(),
  anulada boolean not null default false,
  anulada_el timestamptz,
  anulado_por uuid,
  motivo_anulacion text
);

create table public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  product_id uuid not null references public.products (id),
  delta numeric not null,
  stock_anterior numeric not null,
  stock_nuevo numeric not null,
  motivo text not null,
  creado_por uuid default auth.uid()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  usuario uuid default auth.uid(),
  accion text not null,
  tabla text not null,
  registro uuid,
  detalle jsonb not null default '{}'
);

create function public.eldo_auditar(p_accion text, p_tabla text, p_registro uuid, p_detalle jsonb)
returns void language sql volatile security definer set search_path = public, pg_temp as $$
  insert into audit_log (accion, tabla, registro, detalle) values (p_accion, p_tabla, p_registro, coalesce(p_detalle, '{}'));
$$;

-- Contra-asientos: invierte los movimientos de caja de una operación que todavía no
-- fueron revertidos. Mantiene cuenta y origen; el custodio puede cambiar (quién devuelve).
create function public._eldo3_revertir_caja(p_ref uuid, p_holder uuid, p_descripcion text)
returns integer language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare m record; n integer := 0;
begin
  for m in select * from cash_movements c
           where c.ref_id = p_ref and c.anula_a is null
             and not exists (select 1 from cash_movements x where x.anula_a = c.id)
           order by c.fecha, c.id for update loop
    insert into cash_movements (tipo, origen, monto, descripcion, ref_id, account_id, holder_id, anula_a)
    values (case when m.tipo = 'ingreso' then 'egreso' else 'ingreso' end, m.origen, m.monto,
            left(p_descripcion || ' · ' || coalesce(m.descripcion, ''), 300), p_ref, m.account_id,
            coalesce(p_holder, m.holder_id), m.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 5. VENTAS v3
-- -----------------------------------------------------------------------------
-- Crea una venta repartida por cuenta. p_historia conserva costo y dueño de las
-- líneas al corregir: {"<productoId>": {"costoUnit": n, "ownerAccountId": "<uuid>"}}.
create function public._eldo3_crear_venta(
  p_cliente_id uuid, p_items jsonb, p_metodo_pago text, p_modalidad text, p_holder_id uuid,
  p_pedido_id uuid, p_corrige_a uuid, p_historia jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  it jsonb; pr record; v_qty numeric; v_precio numeric; v_pct numeric; v_cu numeric; v_owner uuid;
  v_sub numeric; v_cos numeric; v_com numeric;
  lineas jsonb := '[]'; porCuenta jsonb := '{}'; v_total numeric := 0; v_costo numeric := 0; v_comision numeric := 0;
  v_sale uuid; k text; a jsonb;
begin
  if p_modalidad is null or p_modalidad not in ('propia', 'revendedor') then
    raise exception 'Elegí la modalidad: venta propia o por revendedor.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un producto.';
  end if;
  perform eldo_valida_custodio(p_holder_id);

  for it in select value from jsonb_array_elements(p_items) loop
    v_qty := nullif(it->>'cantidad', '')::numeric;
    v_precio := nullif(it->>'precioVenta', '')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) then raise exception 'Cantidad inválida.'; end if;
    if v_precio is null or v_precio < 0 then raise exception 'Precio inválido.'; end if;
    if p_modalidad = 'revendedor' then
      v_pct := nullif(it->>'comisionPct', '')::numeric;
      if v_pct is null or v_pct < 0 or v_pct > 100 then raise exception 'Ingresá el %% del revendedor (0 a 100) en cada línea.'; end if;
    else
      v_pct := 0;
    end if;

    -- Descuenta stock solo si alcanza (bloquea la fila; dos ventas simultáneas no lo duplican)
    update products set stock = stock - v_qty
    where id = (it->>'productoId')::uuid and stock >= v_qty
    returning id, nombre, costo, owner_account_id into pr;
    if not found then
      if exists (select 1 from products where id = (it->>'productoId')::uuid) then
        raise exception 'Stock insuficiente de "%".', (select nombre from products where id = (it->>'productoId')::uuid);
      end if;
      raise exception 'Producto inexistente.';
    end if;

    v_cu := coalesce(nullif(p_historia -> pr.id::text ->> 'costoUnit', '')::numeric, pr.costo, 0);
    v_owner := coalesce(nullif(p_historia -> pr.id::text ->> 'ownerAccountId', '')::uuid, pr.owner_account_id);
    v_sub := round(v_qty * v_precio, 2);
    v_cos := round(v_qty * v_cu, 2);
    v_com := round(v_sub * v_pct / 100, 2);

    lineas := lineas || jsonb_build_array(
      jsonb_build_object('productoId', pr.id, 'nombre', pr.nombre, 'cantidad', v_qty, 'precioVenta', v_precio,
                         'costoUnit', v_cu, 'ownerAccountId', v_owner)
      || case when p_modalidad = 'revendedor' then jsonb_build_object('comisionPct', v_pct) else '{}'::jsonb end);

    a := coalesce(porCuenta -> v_owner::text, '{"total":0,"costo":0,"comision":0}');
    porCuenta := porCuenta || jsonb_build_object(v_owner::text, jsonb_build_object(
      'total', (a->>'total')::numeric + v_sub, 'costo', (a->>'costo')::numeric + v_cos,
      'comision', (a->>'comision')::numeric + v_com));
    v_total := v_total + v_sub; v_costo := v_costo + v_cos; v_comision := v_comision + v_com;
  end loop;

  insert into sales (cliente_id, items, total, costo_total, ganancia, metodo_pago, pedido_id, modalidad,
                     comision_total, corrige_a, holder_id)
  values (p_cliente_id, lineas, v_total, v_costo, v_total - v_costo - v_comision, coalesce(p_metodo_pago, ''),
          p_pedido_id, p_modalidad, v_comision, p_corrige_a, p_holder_id)
  returning id into v_sale;

  for k, a in select key, value from jsonb_each(porCuenta) loop
    insert into sale_allocations (sale_id, account_id, total, costo, comision, ganancia, origen)
    values (v_sale, k::uuid, (a->>'total')::numeric, (a->>'costo')::numeric, (a->>'comision')::numeric,
            (a->>'total')::numeric - (a->>'costo')::numeric - (a->>'comision')::numeric, 'v3');
    insert into cash_movements (tipo, origen, monto, descripcion, ref_id, account_id, holder_id)
    values ('ingreso', 'venta', (a->>'total')::numeric, 'Venta', v_sale, k::uuid, p_holder_id);
    if (a->>'comision')::numeric > 0 then
      insert into cash_movements (tipo, origen, monto, descripcion, ref_id, account_id, holder_id)
      values ('egreso', 'comision_revendedor', (a->>'comision')::numeric, 'Comisión de revendedor', v_sale, k::uuid, p_holder_id);
    end if;
  end loop;

  perform eldo_auditar('crear', 'sales', v_sale, jsonb_build_object('total', v_total, 'corrige_a', p_corrige_a));
  return jsonb_build_object('id', v_sale, 'total', v_total, 'costo_total', v_costo, 'comision_total', v_comision,
                            'ganancia', v_total - v_costo - v_comision);
end $$;

create function public.register_sale_v3(p_cliente_id uuid, p_items jsonb, p_metodo_pago text, p_modalidad text,
                                        p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_holder uuid := eldo_requiere_usuario();
begin
  return _eldo3_crear_venta(p_cliente_id, p_items, p_metodo_pago, p_modalidad, coalesce(p_holder_id, v_holder),
                            null, null, '{}'::jsonb);
end $$;

-- Anula una venta. p_holder_id: quién devuelve el dinero (por defecto, quien cobró).
create function public.void_sale_v3(p_sale_id uuid, p_motivo text, p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v record; it jsonb; faltan text[] := '{}'; r jsonb; v_refund uuid;
begin
  perform eldo_requiere_usuario();
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación.'; end if;
  select * into v from sales where id = p_sale_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  if coalesce(v.anulada, false) then raise exception 'La venta ya está anulada.'; end if;
  v_refund := eldo_valida_custodio(coalesce(p_holder_id, v.holder_id));

  if exists (select 1 from sale_allocations where sale_id = v.id and origen = 'v3') then
    for it in select value from jsonb_array_elements(v.items::jsonb) loop
      update products set stock = stock + (it->>'cantidad')::numeric where id = (it->>'productoId')::uuid;
      if not found then faltan := faltan || coalesce(it->>'nombre', it->>'productoId'); end if;
    end loop;
    perform _eldo3_revertir_caja(v.id, v_refund, 'Anulación de venta');
    update sales set anulada = true, anulada_el = now(), motivo_anulacion = p_motivo, anulado_por = auth.uid()
    where id = v.id;
    update orders set estado = 'Pendiente', venta_id = null where venta_id = v.id;
    r := jsonb_build_object('productosNoEncontrados', to_jsonb(faltan));
  else
    -- Venta anterior a la migración: la anula la función actual, sin modificarla.
    -- Sus movimientos de caja quedan en ELDOSTORE (todo el historial es de ELDOSTORE).
    perform eldo_set_ctx(eldo_cuenta('eldostore'), v_refund);
    if _eldo3_devuelve_json('void_sale') then
      r := to_jsonb(void_sale(p_sale_id => v.id, p_motivo => p_motivo));
    else
      perform void_sale(p_sale_id => v.id, p_motivo => p_motivo);
    end if;
    perform eldo_set_ctx(null, null);
    update sales set anulado_por = auth.uid() where id = v.id;
  end if;

  update sale_allocations set anulada = true where sale_id = v.id;
  perform eldo_auditar('anular', 'sales', v.id, jsonb_build_object('motivo', p_motivo, 'devuelve', v_refund));
  return coalesce(r, '{}'::jsonb);
end $$;

-- Corrige una venta: anula la original y registra la nueva en un solo paso.
-- Las líneas conservadas mantienen costo y dueño históricos.
create function public.correct_sale_v3(p_sale_id uuid, p_motivo text, p_cliente_id uuid, p_items jsonb,
                                       p_metodo_pago text, p_modalidad text, p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v record; v_hist jsonb := '{}'; e jsonb; v_estado text; r jsonb;
begin
  perform eldo_requiere_usuario();
  select * into v from sales where id = p_sale_id for update;
  if not found then raise exception 'La venta no existe.'; end if;
  for e in select value from jsonb_array_elements(v.items::jsonb) loop
    if not v_hist ? (e->>'productoId') then
      v_hist := v_hist || jsonb_build_object(e->>'productoId', jsonb_build_object(
        'costoUnit', e->'costoUnit',
        'ownerAccountId', coalesce(e->>'ownerAccountId', eldo_cuenta('eldostore')::text)));
    end if;
  end loop;
  if v.pedido_id is not null then select estado into v_estado from orders where id = v.pedido_id; end if;

  perform void_sale_v3(v.id, p_motivo, v.holder_id);
  r := _eldo3_crear_venta(p_cliente_id, p_items, p_metodo_pago, p_modalidad,
                          coalesce(p_holder_id, v.holder_id), v.pedido_id, v.id, v_hist);
  if v.pedido_id is not null then
    update orders set venta_id = (r->>'id')::uuid, estado = coalesce(v_estado, estado) where id = v.pedido_id;
  end if;
  return r;
end $$;

-- Pedido → venta. La seña hoy no se registra en caja al recibirla (addOrder no toca la
-- caja), así que el total entra completo al convertir: no hay ingreso duplicado (D4).
create function public.convert_order_to_sale_v3(p_order_id uuid, p_metodo_pago text default null,
                                                p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare o record; v_holder uuid := eldo_requiere_usuario(); v_items jsonb; r jsonb;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'El pedido no existe.'; end if;
  if o.venta_id is not null then raise exception 'El pedido ya fue convertido en venta.'; end if;
  if o.estado = 'Cancelado' then raise exception 'El pedido está cancelado.'; end if;
  select jsonb_agg(jsonb_build_object('productoId', e->>'productoId', 'cantidad', (e->>'cantidad')::numeric,
                                      'precioVenta', coalesce(e->'precioVenta', e->'precio')))
    into v_items from jsonb_array_elements(o.items::jsonb) e;
  r := _eldo3_crear_venta(o.cliente_id, v_items, coalesce(nullif(p_metodo_pago, ''), o.metodo_pago), 'propia',
                          coalesce(p_holder_id, v_holder), o.id, null, '{}'::jsonb);
  update orders set venta_id = (r->>'id')::uuid where id = o.id;
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- 6. COMPRAS v3 (usan las funciones actuales; la cuenta es la del dueño del producto)
-- -----------------------------------------------------------------------------
create function public.register_purchase_v3(p_proveedor text, p_producto_id uuid, p_cantidad numeric,
  p_costo_unit numeric, p_metodo_pago text, p_notas text, p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_holder uuid := eldo_requiere_usuario(); v_owner uuid; t0 timestamptz := clock_timestamp(); v_id uuid; r jsonb;
begin
  select owner_account_id into v_owner from products where id = p_producto_id;
  if v_owner is null then raise exception 'Producto inexistente.'; end if;
  v_holder := eldo_valida_custodio(coalesce(p_holder_id, v_holder));
  perform eldo_set_ctx(v_owner, v_holder);
  if _eldo3_devuelve_json('register_purchase') then
    r := to_jsonb(register_purchase(p_proveedor => p_proveedor, p_producto_id => p_producto_id, p_cantidad => p_cantidad::int,
                                    p_costo_unit => p_costo_unit, p_metodo_pago => p_metodo_pago, p_notas => p_notas));
  else
    perform register_purchase(p_proveedor => p_proveedor, p_producto_id => p_producto_id, p_cantidad => p_cantidad::int,
                              p_costo_unit => p_costo_unit, p_metodo_pago => p_metodo_pago, p_notas => p_notas);
  end if;
  perform eldo_set_ctx(null, null);
  select id into v_id from purchases where producto_id = p_producto_id and registrado_en >= t0
  order by registrado_en desc limit 1;
  perform eldo_auditar('crear', 'purchases', v_id, jsonb_build_object('cuenta', v_owner, 'custodio', v_holder));
  return coalesce(r, '{}'::jsonb) || jsonb_build_object('id', v_id);
end $$;

create function public.void_purchase_v3(p_purchase_id uuid, p_motivo text, p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c record; v_holder uuid; r jsonb;
begin
  perform eldo_requiere_usuario();
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación.'; end if;
  select * into c from purchases where id = p_purchase_id for update;
  if not found then raise exception 'La compra no existe.'; end if;
  if coalesce(c.anulada, false) then raise exception 'La compra ya está anulada.'; end if;
  v_holder := eldo_valida_custodio(coalesce(p_holder_id, c.holder_id));
  perform eldo_set_ctx(c.account_id, v_holder);
  if _eldo3_devuelve_json('void_purchase') then
    r := to_jsonb(void_purchase(p_purchase_id => c.id, p_motivo => p_motivo));
  else
    perform void_purchase(p_purchase_id => c.id, p_motivo => p_motivo);
  end if;
  perform eldo_set_ctx(null, null);
  update purchases set anulado_por = auth.uid() where id = c.id;
  perform eldo_auditar('anular', 'purchases', c.id, jsonb_build_object('motivo', p_motivo));
  return coalesce(r, '{}'::jsonb);
end $$;

create function public.correct_purchase_v3(p_purchase_id uuid, p_motivo text, p_proveedor text, p_producto_id uuid,
  p_cantidad numeric, p_costo_unit numeric, p_metodo_pago text, p_notas text, p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c record; r jsonb;
begin
  perform eldo_requiere_usuario();
  select * into c from purchases where id = p_purchase_id for update;
  if not found then raise exception 'La compra no existe.'; end if;
  perform void_purchase_v3(c.id, p_motivo, c.holder_id);
  r := register_purchase_v3(p_proveedor, p_producto_id, p_cantidad, p_costo_unit, p_metodo_pago, p_notas,
                            coalesce(p_holder_id, c.holder_id));
  update purchases set corrige_a = c.id where id = (r->>'id')::uuid;
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- 7. GASTOS v3 (gasto compartido con partes; un solo egreso, sin duplicar)
-- -----------------------------------------------------------------------------
-- p_partes: [{"accountId": "<uuid>", "importe": 5000}, ...]; la suma tiene que dar p_importe.
create function public.register_expense_v3(p_descripcion text, p_categoria text, p_importe numeric, p_metodo_pago text,
  p_notas text, p_partes jsonb, p_holder_id uuid default null, p_corrige_a uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_holder uuid := eldo_requiere_usuario(); v_id uuid; p jsonb; v_suma numeric := 0; v_cuentas uuid[] := '{}'; v_acc uuid; v_imp numeric;
begin
  if coalesce(trim(p_descripcion), '') = '' then raise exception 'Indicá la descripción del gasto.'; end if;
  if p_importe is null or p_importe <= 0 then raise exception 'El importe del gasto tiene que ser mayor a 0.'; end if;
  if p_partes is null or jsonb_typeof(p_partes) <> 'array' or jsonb_array_length(p_partes) = 0 then
    raise exception 'Indicá a qué cuenta corresponde el gasto.';
  end if;
  v_holder := eldo_valida_custodio(coalesce(p_holder_id, v_holder));
  for p in select value from jsonb_array_elements(p_partes) loop
    v_acc := eldo_valida_cuenta(nullif(p->>'accountId', '')::uuid);
    v_imp := nullif(p->>'importe', '')::numeric;
    if v_imp is null or v_imp <= 0 then raise exception 'Cada parte del gasto tiene que ser mayor a 0.'; end if;
    if v_acc = any (v_cuentas) then raise exception 'Una cuenta aparece dos veces en el reparto.'; end if;
    v_cuentas := v_cuentas || v_acc;
    v_suma := v_suma + v_imp;
  end loop;
  if round(v_suma, 2) <> round(p_importe, 2) then
    raise exception 'Las partes suman % y el gasto es de %: tienen que coincidir.', v_suma, p_importe;
  end if;

  insert into expenses (descripcion, categoria, importe, metodo_pago, notas, holder_id, corrige_a)
  values (trim(p_descripcion), coalesce(nullif(p_categoria, ''), 'General'), p_importe, coalesce(p_metodo_pago, ''),
          coalesce(p_notas, ''), v_holder, p_corrige_a)
  returning id into v_id;
  for p in select value from jsonb_array_elements(p_partes) loop
    insert into expense_allocations (expense_id, account_id, importe, origen)
    values (v_id, (p->>'accountId')::uuid, (p->>'importe')::numeric, 'v3');
    insert into cash_movements (tipo, origen, monto, descripcion, ref_id, account_id, holder_id)
    values ('egreso', 'gasto', (p->>'importe')::numeric, left(trim(p_descripcion), 300), v_id, (p->>'accountId')::uuid, v_holder);
  end loop;
  perform eldo_auditar('crear', 'expenses', v_id, jsonb_build_object('importe', p_importe, 'partes', p_partes));
  return jsonb_build_object('id', v_id);
end $$;

create function public.void_expense_v3(p_expense_id uuid, p_motivo text, p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare g record; v_holder uuid; r jsonb;
begin
  perform eldo_requiere_usuario();
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación.'; end if;
  select * into g from expenses where id = p_expense_id for update;
  if not found then raise exception 'El gasto no existe.'; end if;
  if coalesce(g.anulada, false) then raise exception 'El gasto ya está anulado.'; end if;
  v_holder := eldo_valida_custodio(coalesce(p_holder_id, g.holder_id));
  if exists (select 1 from expense_allocations where expense_id = g.id and origen = 'v3') then
    perform _eldo3_revertir_caja(g.id, v_holder, 'Anulación de gasto');
    update expenses set anulada = true, anulada_el = now(), motivo_anulacion = p_motivo, anulado_por = auth.uid()
    where id = g.id;
    r := jsonb_build_object('ok', true);
  else
    perform eldo_set_ctx(eldo_cuenta('eldostore'), v_holder);
    if _eldo3_devuelve_json('void_expense') then
      r := to_jsonb(void_expense(p_expense_id => g.id, p_motivo => p_motivo));
    else
      perform void_expense(p_expense_id => g.id, p_motivo => p_motivo);
    end if;
    perform eldo_set_ctx(null, null);
    update expenses set anulado_por = auth.uid() where id = g.id;
  end if;
  perform eldo_auditar('anular', 'expenses', g.id, jsonb_build_object('motivo', p_motivo));
  return coalesce(r, '{}'::jsonb);
end $$;

create function public.correct_expense_v3(p_expense_id uuid, p_motivo text, p_descripcion text, p_categoria text,
  p_importe numeric, p_metodo_pago text, p_notas text, p_partes jsonb, p_holder_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare g record;
begin
  perform eldo_requiere_usuario();
  select * into g from expenses where id = p_expense_id for update;
  if not found then raise exception 'El gasto no existe.'; end if;
  perform void_expense_v3(g.id, p_motivo, g.holder_id);
  return register_expense_v3(p_descripcion, p_categoria, p_importe, p_metodo_pago, p_notas, p_partes,
                             coalesce(p_holder_id, g.holder_id), g.id);
end $$;

-- -----------------------------------------------------------------------------
-- 8. MOVIMIENTOS ENTRE CUENTAS Y CUSTODIOS
--   liquidacion: misma cuenta, el dinero pasa de un custodio a otro (saldo de la cuenta igual)
--   reparto:     de una cuenta a otra (reparto extraordinario; no es venta ni gasto)
--   retiro:      sale dinero de una cuenta (personal; no es gasto)
--   aporte:      entra dinero a una cuenta
--   apertura:    saldo inicial; usa solo el lado "desde" (negativo) o solo el "hacia" (positivo)
-- -----------------------------------------------------------------------------
create function public.register_transfer(p_tipo text, p_from_account uuid, p_from_holder uuid,
  p_to_account uuid, p_to_holder uuid, p_monto numeric, p_motivo text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid; tiene_desde boolean; tiene_hacia boolean;
begin
  perform eldo_requiere_usuario();
  if p_monto is null or p_monto <= 0 then raise exception 'El monto tiene que ser mayor a 0.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo.'; end if;
  tiene_desde := p_from_account is not null or p_from_holder is not null;
  tiene_hacia := p_to_account is not null or p_to_holder is not null;
  if tiene_desde then perform eldo_valida_cuenta(p_from_account); perform eldo_valida_custodio(p_from_holder); end if;
  if tiene_hacia then perform eldo_valida_cuenta(p_to_account); perform eldo_valida_custodio(p_to_holder); end if;

  if p_tipo = 'liquidacion' then
    if not (tiene_desde and tiene_hacia) or p_from_account <> p_to_account or p_from_holder = p_to_holder then
      raise exception 'Una liquidación mueve dinero de una misma cuenta entre dos personas distintas.';
    end if;
  elsif p_tipo = 'reparto' then
    if not (tiene_desde and tiene_hacia) or p_from_account = p_to_account then
      raise exception 'Un reparto pasa dinero de una cuenta a otra distinta.';
    end if;
  elsif p_tipo = 'retiro' then
    if not tiene_desde or tiene_hacia then raise exception 'Un retiro indica solo de qué cuenta y quién sale el dinero.'; end if;
  elsif p_tipo = 'aporte' then
    if tiene_desde or not tiene_hacia then raise exception 'Un aporte indica solo a qué cuenta y quién recibe el dinero.'; end if;
  elsif p_tipo = 'apertura' then
    if tiene_desde = tiene_hacia then raise exception 'La apertura usa un solo lado: "desde" (saldo negativo) o "hacia" (saldo positivo).'; end if;
  else
    raise exception 'Tipo de movimiento inválido.';
  end if;

  insert into account_transfers (tipo, from_account_id, from_holder_id, to_account_id, to_holder_id, monto, motivo)
  values (p_tipo, p_from_account, p_from_holder, p_to_account, p_to_holder, p_monto, trim(p_motivo))
  returning id into v_id;
  if tiene_desde then
    insert into cash_movements (tipo, origen, monto, descripcion, ref_id, account_id, holder_id)
    values ('egreso', p_tipo, p_monto, left(trim(p_motivo), 300), v_id, p_from_account, p_from_holder);
  end if;
  if tiene_hacia then
    insert into cash_movements (tipo, origen, monto, descripcion, ref_id, account_id, holder_id)
    values ('ingreso', p_tipo, p_monto, left(trim(p_motivo), 300), v_id, p_to_account, p_to_holder);
  end if;
  perform eldo_auditar('crear', 'account_transfers', v_id, jsonb_build_object('tipo', p_tipo, 'monto', p_monto));
  return jsonb_build_object('id', v_id);
end $$;

create function public.void_transfer(p_transfer_id uuid, p_motivo text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare t record;
begin
  perform eldo_requiere_usuario();
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación.'; end if;
  select * into t from account_transfers where id = p_transfer_id for update;
  if not found then raise exception 'El movimiento no existe.'; end if;
  if t.anulada then raise exception 'El movimiento ya está anulado.'; end if;
  perform _eldo3_revertir_caja(t.id, null, 'Anulación');
  update account_transfers set anulada = true, anulada_el = now(), anulado_por = auth.uid(), motivo_anulacion = p_motivo
  where id = t.id;
  perform eldo_auditar('anular', 'account_transfers', t.id, jsonb_build_object('motivo', p_motivo));
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 9. STOCK Y DUEÑO DE PRODUCTOS
-- -----------------------------------------------------------------------------
create function public.adjust_stock_v3(p_product_id uuid, p_delta numeric, p_motivo text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_ant numeric; v_nuevo numeric;
begin
  perform eldo_requiere_usuario();
  if p_delta is null or p_delta = 0 or p_delta <> trunc(p_delta) then raise exception 'Cantidad inválida.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo del ajuste.'; end if;
  select stock into v_ant from products where id = p_product_id for update;
  if not found then raise exception 'Producto inexistente.'; end if;
  v_nuevo := v_ant + p_delta;
  update products set stock = v_nuevo where id = p_product_id;
  insert into stock_adjustments (product_id, delta, stock_anterior, stock_nuevo, motivo)
  values (p_product_id, p_delta, v_ant, v_nuevo, trim(p_motivo));
  perform eldo_auditar('ajustar_stock', 'products', p_product_id, jsonb_build_object('de', v_ant, 'a', v_nuevo, 'motivo', p_motivo));
  return jsonb_build_object('stock', v_nuevo);
end $$;

-- Cambia el dueño de un producto. Las ventas anteriores conservan su dueño (está
-- guardado en cada línea). Queda registrado con el stock y su valor (decisión D8).
create function public.set_product_owner(p_product_id uuid, p_account_id uuid, p_motivo text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare pr record;
begin
  perform eldo_requiere_usuario();
  perform eldo_valida_cuenta(p_account_id);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo del cambio de dueño.'; end if;
  select * into pr from products where id = p_product_id for update;
  if not found then raise exception 'Producto inexistente.'; end if;
  if pr.owner_account_id = p_account_id then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  update products set owner_account_id = p_account_id where id = pr.id;
  perform eldo_auditar('cambiar_dueno', 'products', pr.id, jsonb_build_object(
    'de', pr.owner_account_id, 'a', p_account_id, 'stock', pr.stock, 'valor_a_costo', pr.stock * pr.costo, 'motivo', p_motivo));
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 10. REPORTES CALCULADOS EN LA BASE (exactos sin importar la cantidad de filas)
-- -----------------------------------------------------------------------------
create function public.resumen_cuentas(p_desde date default null, p_hasta date default null)
returns table (account_id uuid, codigo text, nombre text, ventas_cantidad bigint, ventas numeric, costo numeric,
               comisiones numeric, ganancia_bruta numeric, gastos numeric, ganancia_neta numeric, compras numeric,
               retiros numeric, aportes numeric, repartos_recibidos numeric, repartos_enviados numeric, saldo_caja numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform eldo_requiere_usuario();
  return query
  with v as (
    select sa.account_id, count(*) n, sum(sa.total) total, sum(sa.costo) costo, sum(sa.comision) comision, sum(sa.ganancia) ganancia
    from sale_allocations sa join sales s on s.id = sa.sale_id
    where not sa.anulada and not coalesce(s.anulada, false)
      and (p_desde is null or s.fecha::date >= p_desde) and (p_hasta is null or s.fecha::date <= p_hasta)
    group by sa.account_id),
  g as (
    select ea.account_id, sum(ea.importe) importe
    from expense_allocations ea join expenses e on e.id = ea.expense_id
    where not coalesce(e.anulada, false)
      and (p_desde is null or e.fecha::date >= p_desde) and (p_hasta is null or e.fecha::date <= p_hasta)
    group by ea.account_id),
  c as (
    select pu.account_id, sum(pu.total) total from purchases pu
    where not coalesce(pu.anulada, false)
      and (p_desde is null or pu.fecha::date >= p_desde) and (p_hasta is null or pu.fecha::date <= p_hasta)
    group by pu.account_id),
  t as (
    select x.cuenta, sum(x.retiro) retiro, sum(x.aporte) aporte, sum(x.rec) rec, sum(x.env) env from (
      select from_account_id cuenta,
             case when tipo = 'retiro' then monto else 0 end retiro, 0::numeric aporte,
             0::numeric rec, case when tipo = 'reparto' then monto else 0 end env
      from account_transfers where not anulada and from_account_id is not null
        and (p_desde is null or fecha::date >= p_desde) and (p_hasta is null or fecha::date <= p_hasta)
      union all
      select to_account_id, 0, case when tipo = 'aporte' then monto else 0 end,
             case when tipo = 'reparto' then monto else 0 end, 0
      from account_transfers where not anulada and to_account_id is not null
        and (p_desde is null or fecha::date >= p_desde) and (p_hasta is null or fecha::date <= p_hasta)) x
    group by x.cuenta),
  k as (
    select cm.account_id, sum(case when cm.tipo = 'ingreso' then cm.monto else -cm.monto end) saldo
    from cash_movements cm group by cm.account_id)
  select a.id, a.codigo, a.nombre, coalesce(v.n, 0), coalesce(v.total, 0), coalesce(v.costo, 0), coalesce(v.comision, 0),
         coalesce(v.ganancia, 0), coalesce(g.importe, 0), coalesce(v.ganancia, 0) - coalesce(g.importe, 0),
         coalesce(c.total, 0), coalesce(t.retiro, 0), coalesce(t.aporte, 0), coalesce(t.rec, 0), coalesce(t.env, 0),
         coalesce(k.saldo, 0)
  from accounts a
  left join v on v.account_id = a.id left join g on g.account_id = a.id left join c on c.account_id = a.id
  left join t on t.cuenta = a.id left join k on k.account_id = a.id
  order by case a.codigo when 'eldostore' then 0 else 1 end, a.nombre;
end $$;

-- Matriz cuenta × custodio: quién tiene el dinero de quién.
create function public.posiciones_caja()
returns table (account_id uuid, holder_id uuid, saldo numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform eldo_requiere_usuario();
  return query
  select cm.account_id, cm.holder_id, sum(case when cm.tipo = 'ingreso' then cm.monto else -cm.monto end)
  from cash_movements cm group by cm.account_id, cm.holder_id
  having sum(case when cm.tipo = 'ingreso' then cm.monto else -cm.monto end) <> 0;
end $$;

-- Vincula un usuario de Supabase Auth (creado en Authentication → Users) a un custodio.
create function public.vincular_usuario(p_email text, p_holder_id uuid, p_activo boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_uid uuid; v_antes record;
begin
  perform eldo_requiere_usuario();
  -- Solo el administrador administra accesos. Nadie puede darse ni dar permisos de administrador:
  -- esta función no tiene forma de cambiar es_admin.
  if not eldo_es_admin() then
    raise exception 'Solo el administrador puede habilitar, desactivar o modificar usuarios.';
  end if;
  perform eldo_valida_custodio(p_holder_id);
  if p_activo is null then raise exception 'Indicá si el usuario queda activo.'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'No existe un usuario con ese email en Supabase Auth.'; end if;
  if v_uid = auth.uid() then raise exception 'El administrador no puede modificar su propio acceso desde el panel.'; end if;
  select * into v_antes from app_users where user_id = v_uid for update;
  if found and v_antes.es_admin then raise exception 'El acceso del administrador no se modifica desde el panel.'; end if;
  insert into app_users (user_id, holder_id, nombre, activo, es_admin) values (v_uid, p_holder_id, trim(p_email), p_activo, false)
  on conflict (user_id) do update set holder_id = excluded.holder_id, activo = excluded.activo;
  perform eldo_auditar('vincular_usuario', 'app_users', v_uid, jsonb_build_object(
    'custodio_antes', v_antes.holder_id, 'activo_antes', v_antes.activo,
    'custodio', p_holder_id, 'activo', p_activo));
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- 11. PERMISOS Y SEGURIDAD DE LAS TABLAS NUEVAS
-- -----------------------------------------------------------------------------
-- Tablas nuevas: solo lectura para usuarios habilitados; se escriben solo con las funciones.
do $permisos$
declare t text;
begin
  foreach t in array array['accounts','cash_holders','app_users','sale_allocations','expense_allocations',
                           'account_transfers','stock_adjustments','audit_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy lectura_usuarios_habilitados on public.%I for select to authenticated using (public.eldo_es_usuario_activo())', t);
  end loop;
end
$permisos$;

-- Funciones: nadie las ejecuta salvo lo indicado.
do $funciones$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'eldo\_%' or p.proname like '\_eldo3\_%' or p.proname in (
             'register_sale_v3','void_sale_v3','correct_sale_v3','convert_order_to_sale_v3',
             'register_purchase_v3','void_purchase_v3','correct_purchase_v3',
             'register_expense_v3','void_expense_v3','correct_expense_v3',
             'register_transfer','void_transfer','adjust_stock_v3','set_product_owner',
             'resumen_cuentas','posiciones_caja','vincular_usuario')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end
$funciones$;

grant execute on function
  public.register_sale_v3(uuid, jsonb, text, text, uuid),
  public.void_sale_v3(uuid, text, uuid),
  public.correct_sale_v3(uuid, text, uuid, jsonb, text, text, uuid),
  public.convert_order_to_sale_v3(uuid, text, uuid),
  public.register_purchase_v3(text, uuid, numeric, numeric, text, text, uuid),
  public.void_purchase_v3(uuid, text, uuid),
  public.correct_purchase_v3(uuid, text, text, uuid, numeric, numeric, text, text, uuid),
  public.register_expense_v3(text, text, numeric, text, text, jsonb, uuid, uuid),
  public.void_expense_v3(uuid, text, uuid),
  public.correct_expense_v3(uuid, text, text, text, numeric, text, text, jsonb, uuid),
  public.register_transfer(text, uuid, uuid, uuid, uuid, numeric, text),
  public.void_transfer(uuid, text),
  public.adjust_stock_v3(uuid, numeric, text),
  public.set_product_owner(uuid, uuid, text),
  public.resumen_cuentas(date, date),
  public.posiciones_caja(),
  public.vincular_usuario(text, uuid, boolean)
to authenticated;

-- Los valores por defecto se evalúan con el usuario que inserta (panel actual):
grant execute on function public.eldo_ctx_account(), public.eldo_ctx_holder(), public.eldo_es_usuario_activo()
to authenticated;

-- -----------------------------------------------------------------------------
-- 11b. ACCESO A LAS TABLAS Y FUNCIONES EXISTENTES (corrección de seguridad)
-- -----------------------------------------------------------------------------
-- Políticas RESTRICTIVAS: se suman a las actuales (que no se tocan). Un usuario con
-- sesión pero no habilitado no puede leer ni modificar datos internos. Productos:
-- la lectura no se restringe, para no afectar a la tienda pública.
do $restriccion$
declare t text; tablas text[] := array['products','clients','sales','orders','purchases','expenses',
                                       'cash_movements','shipments','app_config'];
begin
  foreach t in array tablas loop
    if to_regclass('public.' || t) is null then continue; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'La tabla % no tiene RLS activado: revisar sus permisos antes de migrar. No se hizo ningún cambio.', t;
    end if;
    execute format('create policy eldo003_alta_habilitados on public.%I as restrictive for insert to authenticated with check (public.eldo_es_usuario_activo())', t);
    execute format('create policy eldo003_cambio_habilitados on public.%I as restrictive for update to authenticated using (public.eldo_es_usuario_activo()) with check (public.eldo_es_usuario_activo())', t);
    execute format('create policy eldo003_baja_habilitados on public.%I as restrictive for delete to authenticated using (public.eldo_es_usuario_activo())', t);
    if t <> 'products' then
      execute format('create policy eldo003_lectura_habilitados on public.%I as restrictive for select to authenticated using (public.eldo_es_usuario_activo())', t);
    end if;
  end loop;
end
$restriccion$;

-- Funciones actuales que modifican datos: se guardan sus permisos y se quita la
-- ejecución directa desde el navegador (public, anon, authenticated). Siguen
-- funcionando dentro de las v3. La reversión restaura estos permisos tal cual.
create table public.eldo_003_permisos_originales (firma text primary key, acl text);
revoke all on public.eldo_003_permisos_originales from anon, authenticated;
do $v2$
declare f record;
begin
  for f in select p.oid::regprocedure::text as sig, p.proacl::text as acl
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'register_sale', 'register_sale_v2', 'void_sale', 'correct_sale', 'convert_order_to_sale',
             'register_purchase', 'void_purchase', 'correct_purchase',
             'register_expense', 'void_expense', 'correct_expense') loop
    insert into public.eldo_003_permisos_originales (firma, acl) values (f.sig, f.acl);
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    -- Asegura que quien instala (dueño de las v3) pueda seguir llamándola.
    if (select pg_get_userbyid(proowner) from pg_proc where oid = f.sig::regprocedure) <> current_user then
      execute format('grant execute on function %s to %I', f.sig, current_user);
    end if;
  end loop;
end
$v2$;

-- -----------------------------------------------------------------------------
-- 12. CONTROL FINAL (dentro de la misma transacción)
-- -----------------------------------------------------------------------------
do $control$
declare n bigint;
begin
  select count(*) into n from sales s
  where not exists (select 1 from sale_allocations a where a.sale_id = s.id);
  if n > 0 then raise exception 'Control: % ventas sin asignación. Se deshace todo.', n; end if;
  select count(*) into n from sales s join sale_allocations a on a.sale_id = s.id
  where a.total <> coalesce(s.total, 0) or a.ganancia <> coalesce(s.ganancia, 0);
  if n > 0 then raise exception 'Control: % asignaciones no coinciden con su venta. Se deshace todo.', n; end if;
  select count(*) into n from cash_movements where account_id is null or holder_id is null;
  if n > 0 then raise exception 'Control: % movimientos de caja sin cuenta. Se deshace todo.', n; end if;
  select count(*) into n from products where owner_account_id is null;
  if n > 0 then raise exception 'Control: % productos sin dueño. Se deshace todo.', n; end if;
end
$control$;

commit;
