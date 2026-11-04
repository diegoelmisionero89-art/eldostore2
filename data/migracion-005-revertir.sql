-- =============================================================================
-- ELDOSTORE — Reversión de la migración 005 (promociones)
--
-- PASO A (solo lectura): qué se perdería. Correrlo primero y guardar el resultado.
-- PASO B: quita las tablas y funciones de la 005, en una sola transacción.
--
-- Se conserva: products (precios, costos, stock, códigos), ventas, caja y todo lo
-- demás. Las ventas registradas con descuento quedan con el precio con el que se
-- vendieron; se pierde solo el detalle de ventas_descuentos.
-- Las categorías renombradas o reasignadas desde el panel NO vuelven al nombre
-- anterior (el historial de esos cambios está en audit_log).
-- Las imágenes subidas quedan en Storage.
-- La tienda y el panel vuelven solos a funcionar como antes de la 005.
-- =============================================================================

-- PASO A
select
  (select count(*) from public.promo_banners) as banners,
  (select count(*) from public.categorias_tienda) as categorias,
  (select count(*) from public.descuentos_producto) as descuentos_historial,
  (select count(*) from public.ofertas_flash) as ofertas_flash_historial,
  (select count(*) from public.ventas_descuentos) as lineas_vendidas_con_descuento,
  (select count(*) from public.audit_log where tabla = 'categorias_tienda' and accion in ('guardar', 'reasignar')
     and coalesce((detalle->>'productos_actualizados')::int, 0) + coalesce((detalle->>'productos')::int, 0) > 0) as cambios_de_categoria_en_productos;

-- PASO B
begin;
drop function if exists
  public.registrar_venta_promocion(uuid, jsonb, text, text, uuid, timestamptz),
  public.promociones_panel(timestamptz),
  public.promociones_tienda(),
  public.terminar_oferta_flash(),
  public.guardar_oferta_flash(text, timestamptz, timestamptz, jsonb),
  public.quitar_descuento(uuid),
  public.poner_descuento(uuid, integer, timestamptz),
  public.eliminar_categoria(uuid),
  public.reasignar_categoria(uuid, uuid),
  public.ordenar_categorias(uuid[]),
  public.guardar_categoria(uuid, text, text, boolean),
  public.eliminar_banner(uuid),
  public.ordenar_banners(text, uuid[]),
  public.guardar_banner(uuid, text, text, text, text, text, boolean),
  public.eldo_requiere_admin(),
  public.eldo_precio_con_descuento(numeric, integer),
  public.eldo_descuento_en(uuid, timestamptz);
drop table if exists public.ventas_descuentos, public.ofertas_flash_productos, public.ofertas_flash,
  public.descuentos_producto, public.categorias_tienda, public.promo_banners;
commit;
select 'Migración 005 revertida' as resultado;
