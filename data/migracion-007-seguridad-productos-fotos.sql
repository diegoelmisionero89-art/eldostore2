-- =============================================================================
-- ELDOSTORE — Migración 007: cierra la lectura de products y la escritura de fotos
--                              a usuarios con sesión que NO están habilitados en el panel
--
-- Propuesta para revisar · 14/11/2026 · NO se ejecutó en la base real.
-- Se instala SOLO con autorización expresa de Diego.
--
-- Problema 1 — products (costos y stock):
--   La política PERMISIVA «acceso_autenticados» (FOR ALL TO public, USING auth.role() = 'authenticated')
--   deja leer products a CUALQUIER usuario con sesión. La 003 le agregó políticas RESTRICTIVAS de alta,
--   cambio y baja (eldo003_*_habilitados), pero a propósito NO la de lectura «para no afectar a la tienda
--   pública». Con el registro abierto en Supabase Auth, cualquiera que cree una cuenta lee los 221
--   productos con costo, stock y stock mínimo. (La tienda pública NO lee la tabla: usa catalogo_tienda(),
--   SECURITY DEFINER, que no pasa por RLS. Por eso cerrar la lectura no la afecta.)
--
-- Problema 2 — fotos (bucket productos-fotos):
--   Las políticas eldostore_fotos_subir / _actualizar / _borrar de storage.objects solo piden
--   bucket_id = 'productos-fotos'. Cualquier usuario con sesión puede subir, reemplazar o borrar fotos
--   de productos, banners, categorías y logos.
--
-- Corrección mínima (solo AGREGA 4 políticas RESTRICTIVAS, el mismo método de la 003):
--   * products: lectura solo para usuarios habilitados del panel (eldo_es_usuario_activo()).
--   * storage.objects, bucket productos-fotos: subir, reemplazar y borrar solo usuarios habilitados.
--     Las políticas restrictivas se suman a las actuales: no se modifica ni borra ninguna política,
--     permiso, función, dato, usuario ni configuración existente. Otros buckets no se tocan.
--
-- Quién queda con qué:
--   * Diego (administrador) y Niko (usuario activo): EXACTAMENTE lo mismo que hoy. Ninguno gana nada.
--   * Usuario con sesión NO habilitado (cuenta creada en Auth, o desactivada en el panel): pierde la
--     lectura de products y la escritura de fotos. Hoy ya no lee ni escribe ninguna otra tabla interna.
--   * Visitante sin sesión: igual que hoy (catálogo, promociones y fotos públicas; nunca costos).
--   * Funciones del panel (SECURITY DEFINER, dueño postgres con BYPASSRLS) y service_role: sin cambios.
--
-- Una sola transacción con controles: si algo falla, PostgreSQL hace ROLLBACK y no queda nada aplicado.
--   * SQL Editor de Supabase: muestra el ERROR y no aparece el mensaje final.
--   * psql: muestra el ERROR y, al llegar a COMMIT, responde ROLLBACK.
-- La última línea tiene que ser:  -- FIN DEL ARCHIVO 007
-- =============================================================================
begin;

do $verificar$
begin
  if to_regprocedure('public.eldo_es_usuario_activo()') is null then
    raise exception 'Falta eldo_es_usuario_activo() (migración 003). No se hizo ningún cambio.';
  end if;
  if not has_function_privilege('authenticated', 'public.eldo_es_usuario_activo()', 'execute') then
    raise exception 'authenticated no puede ejecutar eldo_es_usuario_activo(): las políticas bloquearían a todos. No se hizo ningún cambio.';
  end if;
  if exists (select 1 from pg_policies where policyname like 'eldo007\_%') then
    raise exception 'Ya hay políticas eldo007_*: la 007 parece aplicada. No se hizo ningún cambio.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.products'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'products o storage.objects sin RLS activado. No se hizo ningún cambio.';
  end if;
  if to_regclass('storage.buckets') is null
     or not exists (select 1 from storage.buckets where id = 'productos-fotos') then
    raise exception 'No existe el bucket productos-fotos. No se hizo ningún cambio.';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('eldostore_fotos_subir', 'eldostore_fotos_actualizar', 'eldostore_fotos_borrar')) <> 3 then
    raise exception 'No están las 3 políticas eldostore_fotos_* esperadas en storage.objects. No se hizo ningún cambio.';
  end if;
end
$verificar$;

-- 1. products: lectura solo para usuarios habilitados del panel
create policy eldo007_lectura_habilitados on public.products
  as restrictive for select to authenticated
  using (public.eldo_es_usuario_activo());

-- 2. Fotos: subir, reemplazar y borrar en productos-fotos solo usuarios habilitados del panel
--    (las condiciones dejan pasar los demás buckets, para no cambiar nada fuera de productos-fotos)
create policy eldo007_fotos_subir_habilitados on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'productos-fotos' or public.eldo_es_usuario_activo());
create policy eldo007_fotos_actualizar_habilitados on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'productos-fotos' or public.eldo_es_usuario_activo())
  with check (bucket_id <> 'productos-fotos' or public.eldo_es_usuario_activo());
create policy eldo007_fotos_borrar_habilitados on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'productos-fotos' or public.eldo_es_usuario_activo());

-- 3. Controles dentro de la transacción (si alguno falla, no se aplica nada)
do $controles$
declare
  v_total integer; v_activos integer; v_catalogo integer; v_visible integer; u record;
  v_claims text := current_setting('request.jwt.claims', true);
begin
  select count(*) into v_total from public.products;
  select count(*) into v_activos from public.products where activo;
  if (select count(*) from pg_policies where policyname like 'eldo007\_%') <> 4 then
    raise exception 'Control: no quedaron las 4 políticas eldo007_*. No se aplicó nada.';
  end if;

  -- a) Un usuario con sesión que NO está en el panel no ve ningún producto
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000007","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_visible from public.products;
  perform set_config('role', 'none', true);
  if v_visible <> 0 then
    raise exception 'Control: un usuario externo todavía ve % productos. No se aplicó nada.', v_visible;
  end if;

  -- b) Cada usuario habilitado del panel (Diego, Niko) sigue viendo TODOS los productos
  for u in select user_id from public.app_users where activo loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into v_visible from public.products;
    perform set_config('role', 'none', true);
    if v_visible <> v_total then
      raise exception 'Control: un usuario habilitado ve % de % productos. No se aplicó nada.', v_visible, v_total;
    end if;
  end loop;

  -- c) La tienda pública (visitante sin sesión) sigue viendo el catálogo completo
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  select count(*) into v_catalogo from public.catalogo_tienda();
  perform set_config('role', 'none', true);
  if v_catalogo <> v_activos then
    raise exception 'Control: catalogo_tienda() devuelve % de % productos activos. No se aplicó nada.', v_catalogo, v_activos;
  end if;

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- d) No cambió ningún permiso de funciones de la 003
  if has_function_privilege('authenticated', 'public.eldo_es_admin()', 'execute') then
    raise exception 'Control: cambió el permiso de eldo_es_admin. No se aplicó nada.';
  end if;
end
$controles$;

commit;

-- Comprobación final (fuera de la transacción): lee el estado REAL de la base. Puede no mostrarse si
-- el editor se detuvo en un error; en ese caso no quedó ningún cambio (ver arriba).
select case when (select count(*) from pg_policies where policyname like 'eldo007\_%') = 4
            then 'Migración 007 aplicada: products y fotos solo para usuarios habilitados del panel'
            else 'ATENCIÓN: la 007 NO se aplicó (no quedó ningún cambio). Revisá el error de arriba.' end as resultado,
       (select count(*) from public.catalogo_tienda()) as productos_en_la_tienda;
-- FIN DEL ARCHIVO 007
