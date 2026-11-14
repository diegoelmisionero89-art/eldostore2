-- =============================================================================
-- ELDOSTORE — Migración 006b: corrección del permiso de lectura de mkt_ventas
--
-- Versión para REVISIÓN · 13/11/2026 · NO se ejecutó en la base real.
-- Requiere la 006 instalada. Se instala SOLO con autorización de Diego.
--
-- Problema (detectado en producción después de instalar la 006):
--   La política RLS «lectura_administrador» de mkt_ventas llama a eldo_es_admin().
--   Las políticas se evalúan con los permisos de QUIEN CONSULTA, y en producción la
--   migración 003 le quitó a los usuarios autenticados el permiso de EXECUTE sobre
--   eldo_es_admin() (solo les devolvió eldo_es_usuario_activo(), eldo_ctx_account() y
--   eldo_ctx_holder()). Resultado: cualquier SELECT directo a mkt_ventas de un usuario
--   autenticado —incluido el administrador— termina en «permission denied for function
--   eldo_es_admin» en vez de devolver sus filas. No se filtraba información; solo fallaba.
--   En la base de prueba no apareció porque no reproducía ese REVOKE de la 003.
--
-- Corrección mínima (solo objetos de la 006; NO cambia permisos de nada existente):
--   * Nueva función public.mkt_es_admin(): SECURITY DEFINER (corre con los permisos de su
--     dueño, como todas las de la 006), devuelve eldo_es_admin() del usuario que consulta.
--     Solo dice si QUIEN CONSULTA es administrador: el mismo dato que ya entrega
--     mkt_panel() en «esAdmin». EXECUTE solo para authenticated (no anon, no public).
--   * La política «lectura_administrador» de mkt_ventas pasa a usar mkt_es_admin().
--   Se descartó dar EXECUTE de eldo_es_admin() a authenticated: cambiaría el permiso de
--   una función de la 003 que usan otras partes del sistema.
--
-- No toca datos, products, ventas, caja, cuentas, usuarios, promociones ni las demás
-- políticas. Una sola transacción con controles: si algo falla, no queda nada aplicado.
-- La última línea tiene que ser:  -- FIN DEL ARCHIVO 006b
-- =============================================================================
begin;

do $verificar$
begin
  if to_regclass('public.mkt_ventas') is null then
    raise exception 'La migración 006 no está instalada. No se hizo ningún cambio.';
  end if;
  if to_regprocedure('public.mkt_es_admin()') is not null then
    raise exception 'Ya existe mkt_es_admin(): la 006b parece aplicada. No se hizo ningún cambio.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mkt_ventas'
                 and policyname = 'lectura_administrador') then
    raise exception 'No está la política lectura_administrador de mkt_ventas. No se hizo ningún cambio.';
  end if;
end
$verificar$;

create function public.mkt_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select eldo_es_admin()
$$;
revoke all on function public.mkt_es_admin() from public, anon, authenticated;
grant execute on function public.mkt_es_admin() to authenticated;

drop policy lectura_administrador on public.mkt_ventas;
create policy lectura_administrador on public.mkt_ventas for select to authenticated using (public.mkt_es_admin());

do $controles$
begin
  if has_function_privilege('anon', 'public.mkt_es_admin()', 'execute') then
    raise exception 'Control: anon podría ejecutar mkt_es_admin. No se aplicó nada.';
  end if;
  if not has_function_privilege('authenticated', 'public.mkt_es_admin()', 'execute') then
    raise exception 'Control: authenticated no puede ejecutar mkt_es_admin. No se aplicó nada.';
  end if;
  if has_function_privilege('authenticated', 'public.eldo_es_admin()', 'execute') then
    raise exception 'Control: cambió el permiso de eldo_es_admin (no debería). No se aplicó nada.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.mkt_ventas'::regclass) then
    raise exception 'Control: mkt_ventas sin RLS. No se aplicó nada.';
  end if;
end
$controles$;

commit;

select 'Migración 006b aplicada: el administrador puede leer mkt_ventas; los demás no' as resultado;
-- FIN DEL ARCHIVO 006b
