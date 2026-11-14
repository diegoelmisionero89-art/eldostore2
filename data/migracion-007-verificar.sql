-- =============================================================================
-- ELDOSTORE — Verificación de la migración 007 (SOLO LECTURA: todo dentro de una transacción que se deshace)
-- Correr DESPUÉS de aplicar la 007. Devuelve una fila por control con OK / FALLA.
-- =============================================================================
begin;
create temp table v007 (n serial, control text, resultado text) on commit drop;
grant all on v007 to anon, authenticated; grant all on sequence v007_n_seq to anon, authenticated;

insert into v007 (control, resultado)
select 'Hay 4 políticas eldo007, todas restrictivas y para authenticated',
       case when count(*) = 4 and bool_and(permissive = 'RESTRICTIVE' and roles = '{authenticated}') then 'OK' else 'FALLA: ' || count(*) end
  from pg_policies where policyname like 'eldo007\_%';
insert into v007 (control, resultado)
select 'Las políticas anteriores de products y storage.objects siguen igual (4 + 3)',
       case when count(*) = 7 then 'OK' else 'FALLA: ' || count(*) end
  from pg_policies where policyname in ('acceso_autenticados', 'eldo003_alta_habilitados', 'eldo003_cambio_habilitados',
        'eldo003_baja_habilitados', 'eldostore_fotos_subir', 'eldostore_fotos_actualizar', 'eldostore_fotos_borrar')
   and ((schemaname = 'public' and tablename = 'products') or (schemaname = 'storage' and tablename = 'objects'));
insert into v007 (control, resultado)
select 'eldo_es_admin() sigue NO ejecutable por authenticated',
       case when not has_function_privilege('authenticated', 'public.eldo_es_admin()', 'execute') then 'OK' else 'FALLA' end;

-- Usuario con sesión que NO está en el panel
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000007","role":"authenticated"}', true);
set local role authenticated;
insert into v007 (control, resultado)
select 'Usuario externo: 0 productos visibles', case when count(*) = 0 then 'OK' else 'FALLA: ve ' || count(*) end from public.products;
insert into v007 (control, resultado)
select 'Usuario externo: catálogo público visible', case when count(*) > 0 then 'OK (' || count(*) || ')' else 'FALLA' end from public.catalogo_tienda();
reset role;

-- Visitante sin sesión
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into v007 (control, resultado)
select 'Visitante: ve el catálogo público', case when count(*) > 0 then 'OK (' || count(*) || ')' else 'FALLA' end
  from public.catalogo_tienda();
insert into v007 (control, resultado)
select 'Visitante: 0 productos visibles en la tabla', case when count(*) = 0 then 'OK' else 'FALLA: ve ' || count(*) end from public.products;
reset role;
insert into v007 (control, resultado)
select 'Catálogo = productos activos', case when (select count(*) from public.catalogo_tienda()) = (select count(*) from public.products where activo) then 'OK' else 'FALLA' end;

-- Cada usuario habilitado del panel ve todos los productos
do $$
declare u record; v integer; t integer;
begin
  select count(*) into t from public.products;
  for u in select user_id, nombre, es_admin from public.app_users where activo loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into v from public.products;
    perform set_config('role', 'none', true);
    insert into v007 (control, resultado) values (
      'Usuario habilitado ' || case when u.es_admin then '(administrador)' else '(no administrador)' end || ': ve todos los productos',
      case when v = t then 'OK (' || v || ')' else 'FALLA: ' || v || ' de ' || t end);
  end loop;
end $$;

select control, resultado from v007 order by n;
rollback;
