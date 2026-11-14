-- =============================================================================
-- ELDOSTORE — Reversión de la migración 007
-- Quita SOLO las 4 políticas eldo007_* y deja products y las fotos exactamente como antes de la 007
-- (vuelve a abrir los dos problemas de seguridad: usar solo si la 007 rompió algo).
-- No toca datos, permisos, funciones ni las demás políticas.
-- =============================================================================
begin;
do $revertir$
begin
  if not exists (select 1 from pg_policies where policyname like 'eldo007\_%') then
    raise exception 'La migración 007 no está aplicada. No se hizo nada.';
  end if;
end
$revertir$;
drop policy if exists eldo007_lectura_habilitados on public.products;
drop policy if exists eldo007_fotos_subir_habilitados on storage.objects;
drop policy if exists eldo007_fotos_actualizar_habilitados on storage.objects;
drop policy if exists eldo007_fotos_borrar_habilitados on storage.objects;
commit;
select case when (select count(*) from pg_policies where policyname like 'eldo007\_%') = 0
            then 'Migración 007 revertida: products y fotos quedan como antes'
            else 'ATENCIÓN: la reversión NO se aplicó' end as resultado;
-- FIN DEL ARCHIVO 007-revertir
