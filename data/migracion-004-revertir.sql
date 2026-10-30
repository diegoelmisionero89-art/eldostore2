-- =============================================================================
-- ELDOSTORE — Reversión de la migración 004 (varias fotos por producto)
-- Quita la tabla de fotos adicionales y la función fotos_tienda().
-- La foto principal de cada producto (products.foto) no se toca.
-- Los archivos subidos quedan en Storage (productos-fotos); no se borran.
-- Después de revertir, la tienda vuelve sola a mostrar una foto por producto.
-- =============================================================================
begin;
drop function if exists public.fotos_tienda();
drop table if exists public.product_fotos;
commit;
select 'Migración 004 revertida' as resultado;
