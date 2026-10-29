-- =============================================================================
-- ELDOSTORE — Reversión de la migración 003 (tres cuentas)
--
-- PASO A (solo lectura): muestra qué información de cuentas se va a perder.
-- PASO B: quita todo lo que agregó la 003, en una sola transacción.
--
-- Qué se conserva: todas las ventas, compras, gastos, pedidos y movimientos de caja
-- (incluidos los registrados con las funciones v3). Los totales generales siguen
-- siendo correctos. Qué se pierde: a qué cuenta y custodio corresponde cada importe,
-- los repartos de gastos, la auditoría y los usuarios del panel (app_users).
-- También quita las políticas restrictivas agregadas y devuelve a las funciones v2
-- los permisos de ejecución que tenían antes de migrar.
-- Las funciones originales (v2) nunca se tocaron: siguen funcionando igual.
-- Después de revertir, volver a publicar el panel anterior.
-- =============================================================================

-- PASO A — correr solo esta consulta primero y guardar el resultado.
select
  (select count(*) from public.sale_allocations where origen = 'v3') as asignaciones_de_ventas_v3,
  (select count(*) from public.expense_allocations where origen = 'v3') as partes_de_gastos_v3,
  (select count(*) from public.account_transfers) as movimientos_entre_cuentas,
  (select count(*) from public.cash_movements c join public.accounts a on a.id = c.account_id where a.codigo <> 'eldostore') as movimientos_fuera_de_eldostore,
  (select count(*) from public.products p join public.accounts a on a.id = p.owner_account_id where a.codigo <> 'eldostore') as productos_de_niko_o_ayelen,
  (select count(*) from public.audit_log) as registros_de_auditoria;

-- PASO B — revertir (pegar desde aquí hasta el final).
begin;

-- Políticas restrictivas agregadas a las tablas existentes
do $politicas$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public' and policyname like 'eldo003\_%' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end
$politicas$;

-- Permisos originales de las funciones v2 (se restauran tal como estaban)
do $permisos$
declare f record; g record;
begin
  if to_regclass('public.eldo_003_permisos_originales') is null then return; end if;
  for f in select firma, acl from public.eldo_003_permisos_originales loop
    if f.acl is null then
      -- Sin permisos explícitos = permiso por defecto de PostgreSQL (PUBLIC puede ejecutar)
      execute format('grant execute on function %s to public', f.firma);
    else
      for g in select distinct grantee from aclexplode(f.acl::aclitem[]) where privilege_type = 'EXECUTE' loop
        if g.grantee = 0 then execute format('grant execute on function %s to public', f.firma);
        else execute format('grant execute on function %s to %I', f.firma, g.grantee::regrole::text); end if;
      end loop;
    end if;
  end loop;
end
$permisos$;
drop table if exists public.eldo_003_permisos_originales;

drop function if exists
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
  public.vincular_usuario(text, uuid, boolean),
  public._eldo3_crear_venta(uuid, jsonb, text, text, uuid, uuid, uuid, jsonb),
  public._eldo3_revertir_caja(uuid, uuid, text),
  public._eldo3_devuelve_json(text),
  public.eldo_auditar(text, text, uuid, jsonb),
  public.eldo_set_ctx(uuid, uuid),
  public.eldo_valida_cuenta(uuid),
  public.eldo_valida_custodio(uuid),
  public.eldo_requiere_usuario(),
  public.eldo_es_admin();

-- Columnas agregadas a tablas existentes (los datos de esas filas se conservan)
alter table public.cash_movements
  drop column if exists anula_a, drop column if exists creado_por,
  drop column if exists holder_id, drop column if exists account_id;
drop index if exists public.cash_movements_ref_id_idx;
alter table public.expenses drop column if exists anulado_por, drop column if exists creado_por, drop column if exists holder_id;
alter table public.purchases
  drop column if exists registrado_en, drop column if exists anulado_por, drop column if exists creado_por,
  drop column if exists holder_id, drop column if exists account_id;
alter table public.sales drop column if exists anulado_por, drop column if exists creado_por, drop column if exists holder_id;
alter table public.products drop column if exists owner_account_id;

-- Tablas nuevas
drop table if exists public.audit_log, public.stock_adjustments, public.account_transfers,
  public.expense_allocations, public.sale_allocations, public.app_users, public.cash_holders;

drop table if exists public.accounts;
drop function if exists public.eldo_es_usuario_activo(), public.eldo_ctx_account(), public.eldo_ctx_holder(),
  public.eldo_cuenta(text), public.eldo_custodio(text);

commit;
