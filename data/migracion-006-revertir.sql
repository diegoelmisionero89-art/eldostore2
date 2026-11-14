-- =============================================================================
-- ELDOSTORE — Reversión de la migración 006 (Vendedores asociados V1)
--
-- Quita SOLO lo que agregó la 006: sus 4 tablas, su secuencia y sus funciones.
-- No toca products, ventas, cuentas, usuarios ni promociones. Los movimientos de caja de comisiones
-- cobradas (origen 'comision_asociado') QUEDAN en la caja: son dinero real que entró.
--
-- ATENCIÓN: borra los vendedores, productos asociados y ventas asociadas cargados.
-- Por eso se NIEGA si hay datos, salvo que primero se descargue un respaldo y se
-- cambie abajo  v_confirmar boolean := false  por  true.
-- Las fotos subidas quedan en Storage (carpetas vendedores/ y asociados/).
-- =============================================================================
begin;

do $revertir$
declare v_confirmar boolean := false;   -- cambiar a true SOLO si hay datos y ya se respaldaron
begin
  if to_regclass('public.mkt_vendedores') is null then
    raise exception 'La migración 006 no está instalada. No se hizo nada.';
  end if;
  if not v_confirmar and (exists (select 1 from public.mkt_vendedores) or exists (select 1 from public.mkt_ventas)) then
    raise exception 'Hay vendedores o ventas asociadas cargados. Respaldalos y cambiá v_confirmar a true para continuar. No se hizo nada.';
  end if;
end
$revertir$;

drop function if exists public.tiendas_asociadas();
drop function if exists public.mkt_panel();
drop function if exists public.mkt_comision_cobrada(uuid, boolean, uuid);
drop function if exists public.mkt_anular_venta(uuid, text, uuid);
drop function if exists public.mkt_revertir_comision(uuid, uuid, text);
drop function if exists public.mkt_mov_comision_vigente(uuid);
drop function if exists public.mkt_registrar_venta(jsonb);
drop function if exists public.mkt_eliminar_producto(uuid);
drop function if exists public.mkt_estado_producto(uuid, text);
drop function if exists public.mkt_guardar_producto(uuid, jsonb);
drop function if exists public.mkt_activar_vendedor(uuid, boolean);
drop function if exists public.mkt_guardar_vendedor(uuid, jsonb);
drop function if exists public.mkt_slug(text);
drop function if exists public.mkt_requiere_admin();
drop table if exists public.mkt_ventas;
drop table if exists public.mkt_producto_fotos;
drop table if exists public.mkt_productos;
drop table if exists public.mkt_vendedores;
drop sequence if exists public.mkt_productos_codigo_seq;

commit;
select 'Migración 006 revertida: la tienda y el panel quedan como antes' as resultado;
