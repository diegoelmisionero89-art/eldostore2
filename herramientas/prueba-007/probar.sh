#!/usr/bin/env bash
# Prueba la migración 007 en una base PostgreSQL DESCARTABLE (nunca en producción).
# Uso: PGURL=postgresql://postgres@127.0.0.1:55998/postgres PGPASSWORD=x herramientas/prueba-007/probar.sh
set -u
D=$(cd "$(dirname "$0")" && pwd); R=$(cd "$D/../.." && pwd)
: "${PGURL:?Falta PGURL (base descartable)}"
M="$R/data/migracion-007-seguridad-productos-fotos.sql"; REV="$R/data/migracion-007-revertir.sql"
ok=0; mal=0
DIEGO=11111111-1111-1111-1111-111111111111; NIKO=22222222-2222-2222-2222-222222222222
AYELEN=33333333-3333-3333-3333-333333333333; EXT=99999999-9999-4999-8999-999999999999

# q <rol> <uid|-> <sql> [previo]: corre <sql> como ese rol, con el JWT que mandaría Supabase, y DESHACE todo
# al final. [previo] se ejecuta antes como postgres (dentro de la misma transacción, también se deshace).
q() {
  local rol=$1 uid=$2 sql=$3 previo=${4:-} claims
  if [[ $uid == - ]]; then claims="{\"role\":\"$rol\"}"; else claims="{\"sub\":\"$uid\",\"role\":\"$rol\"}"; fi
  psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 \
    -c "begin; $previo set local request.jwt.claims = '$claims'; set local role $rol; $sql; rollback;" 2>&1 \
    | sed -E 's/^psql:[^E]*ERROR: +/ERROR:/' | tr '\n' ' ' | sed 's/ *$//'
}
r() { if [[ $3 =~ $2 ]]; then ok=$((ok+1)); echo "[OK]    $1 → $3"; else mal=$((mal+1)); echo "[FALLA] $1 → esperado /$2/, obtenido: $3"; fi; }
sql() { psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -c "$1" 2>&1 | tr '\n' ' ' | sed 's/ *$//'; }
nueva_base() {
  psql "$PGURL" -X -q -c "drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema public cascade; create schema public; grant usage on schema public to public;" >/dev/null 2>&1
  psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f "$D/base-simulada.sql" >/dev/null || { echo "No se pudo crear la base simulada"; exit 1; }
}
# Huella de todo lo que la 007 NO debe cambiar: datos, permisos de tablas y funciones, políticas que no son eldo007
huella() { sql "select md5(string_agg(x, '|' order by x)) from (
  select 'p'||t::text x from public.products t union all select 's'||t::text from public.sales t
  union all select 'u'||t::text from public.app_users t union all select 'o'||bucket_id||name from storage.objects
  union all select 'pol'||schemaname||tablename||policyname||permissive||cmd||roles::text||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where policyname not like 'eldo007%'
  union all select 'g'||table_schema||table_name||grantee||privilege_type from information_schema.role_table_grants where table_schema in ('public','storage')
  union all select 'f'||p.oid::regprocedure::text||coalesce(p.proacl::text,'') from pg_proc p where pronamespace in ('public'::regnamespace,'auth'::regnamespace)) z"; }

# Las operaciones de fotos se miden por su EFECTO real (contado después como postgres, dentro de la misma
# transacción que se deshace): subidas que quedaron, fotos que cambiaron, fotos que se borraron.
INS_FOTO="insert into storage.objects (bucket_id, name) values ('productos-fotos', 'optimizadas/prueba/nueva.webp'); reset role; select count(*) from storage.objects where name = 'optimizadas/prueba/nueva.webp'"
UPD_FOTO="update storage.objects set metadata = '{\"x\":1}' where bucket_id = 'productos-fotos'; reset role; select count(*) from storage.objects where metadata is not null"
DEL_FOTO="delete from storage.objects where bucket_id = 'productos-fotos'; reset role; select 3 - count(*) from storage.objects where bucket_id = 'productos-fotos'"
# Escenario futuro: si algún día se agrega una política de LECTURA en storage.objects (hoy no hay ninguna),
# reemplazar y borrar quedarían habilitados para cualquier usuario con sesión. Se simula con una política temporal.
CON_SELECT="create policy tmp_lectura on storage.objects for select to authenticated using (true);"

echo "== ANTES de la 007 (reproduce los dos problemas, como en producción hoy) =="
nueva_base
r "Problema 1: usuario externo lee products con costos" "^4 34000$" "$(q authenticated $EXT "select count(*) from products; select sum(costo) from products")"
r "Problema 2: usuario externo SUBE una foto (la foto queda guardada)" "^1$" "$(q authenticated $EXT "$INS_FOTO")"
r "Hoy: usuario externo no logra reemplazar fotos (no hay política de lectura en storage.objects)" "^0$" "$(q authenticated $EXT "$UPD_FOTO")"
r "Hoy: usuario externo no logra borrar fotos (mismo motivo)" "^0$" "$(q authenticated $EXT "$DEL_FOTO")"
r "Riesgo latente: con una política de lectura, el externo REEMPLAZARÍA las 3 fotos" "^3$" "$(q authenticated $EXT "$UPD_FOTO" "$CON_SELECT")"
r "Riesgo latente: con una política de lectura, el externo BORRARÍA las 3 fotos" "^3$" "$(q authenticated $EXT "$DEL_FOTO" "$CON_SELECT")"
H0=$(huella)
CAT="select md5(string_agg(c::text, '|' order by c::text)) from catalogo_tienda() c"
C0=$(q anon - "$CAT")

echo "== Aplicación =="
r "007: aplicación" "007 aplicada.*\|3$" "$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$M" 2>&1 | tail -1)"
r "007: volver a aplicarla se niega sin cambiar nada" "parece aplicada" "$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$M" 2>&1 | grep -o 'parece aplicada' | head -1)"
r "Solo se agregaron las 4 políticas: datos, permisos, funciones y demás políticas idénticos" "^iguales$" "$( [[ $(huella) == "$H0" ]] && echo iguales || echo distintas)"
r "Las 4 políticas nuevas son RESTRICTIVAS y solo para authenticated" "^4$" "$(sql "select count(*) from pg_policies where policyname like 'eldo007%' and permissive = 'RESTRICTIVE' and roles = '{authenticated}'")"

echo "== Diego (administrador): conserva todo =="
r "Diego lee todos los productos con costo" "^4 34000$" "$(q authenticated $DIEGO "select count(*) from products; select sum(costo) from products")"
r "Diego crea un producto (insert ... returning, como el panel)" "^Nuevo$" "$(q authenticated $DIEGO "insert into products (codigo, nombre, costo, precio, stock) values ('900', 'Nuevo', 1, 2, 1) returning nombre")"
r "Diego edita un producto (update ... returning)" "^16000$" "$(q authenticated $DIEGO "update products set precio = 16000 where codigo = '001' returning precio")"
r "Diego borra un producto" "^1$" "$(q authenticated $DIEGO "with d as (delete from products where codigo = '004' returning 1) select count(*) from d")"
r "Diego importa con upsert (on conflict do nothing)" "^5$" "$(q authenticated $DIEGO "insert into products (codigo, nombre) values ('001','x'),('901','y') on conflict (codigo) do nothing; select count(*) from products")"
r "Diego sube una foto" "^1$" "$(q authenticated $DIEGO "$INS_FOTO")"
r "Diego: reemplazar y borrar por SQL, igual que hoy (0 y 0, porque no hay política de lectura)" "^0 0$" "$(q authenticated $DIEGO "$UPD_FOTO"; echo -n ' '; q authenticated $DIEGO "$DEL_FOTO")"
r "Diego: con una política de lectura, conserva reemplazar y borrar" "^3 3$" "$(q authenticated $DIEGO "$UPD_FOTO" "$CON_SELECT"; echo -n ' '; q authenticated $DIEGO "$DEL_FOTO" "$CON_SELECT")"
r "Diego sigue sin ejecutar eldo_es_admin() directo (igual que antes)" "permission denied for function eldo_es_admin" "$(q authenticated $DIEGO "select eldo_es_admin()")"

echo "== Niko (usuario activo): lo mismo que hoy, nada más =="
r "Niko lee todos los productos" "^4$" "$(q authenticated $NIKO "select count(*) from products")"
r "Niko lee el stock de un producto (como db.js)" "^3$" "$(q authenticated $NIKO "select stock from products where codigo = '001'")"
r "Niko edita un producto" "^9000$" "$(q authenticated $NIKO "update products set precio = 9000 where codigo = '002' returning precio")"
r "Niko ajusta stock con la función del panel" "^6$" "$(q authenticated $NIKO "select ajustar_stock_prueba('003', 1)")"
r "Niko sube una foto (igual que hoy)" "^1$" "$(q authenticated $NIKO "$INS_FOTO")"
r "Niko: reemplazar y borrar, igual que hoy" "^0 0$" "$(q authenticated $NIKO "$UPD_FOTO"; echo -n ' '; q authenticated $NIKO "$DEL_FOTO")"
r "Niko: con una política de lectura, igual que Diego (no pierde ni gana)" "^3 3$" "$(q authenticated $NIKO "$UPD_FOTO" "$CON_SELECT"; echo -n ' '; q authenticated $NIKO "$DEL_FOTO" "$CON_SELECT")"
r "Niko no gana privilegios: eldo_es_admin() sigue denegado" "permission denied for function eldo_es_admin" "$(q authenticated $NIKO "select eldo_es_admin()")"
r "Niko no gana privilegios: no puede cambiar su rol en app_users" "^0$|ERROR" "$(q authenticated $NIKO "with u as (update app_users set es_admin = true where user_id = auth.uid() returning 1) select count(*) from u")"
r "Niko lee ventas igual que antes" "^2$" "$(q authenticated $NIKO "select count(*) from sales")"

echo "== Usuario con sesión NO habilitado (cuenta creada en Auth) =="
r "Externo: products vacío (sin costos ni stock)" "^0$" "$(q authenticated $EXT "select count(*) from products; select sum(costo) from products")"
r "Externo: buscar un producto por código no devuelve nada" "^$" "$(q authenticated $EXT "select costo from products where codigo = '001'")"
r "Externo: no puede editar productos" "^0$" "$(q authenticated $EXT "with u as (update products set precio = 1 returning 1) select count(*) from u")"
r "Externo: no puede crear productos" "ERROR:.*row-level security" "$(q authenticated $EXT "insert into products (codigo, nombre) values ('x1', 'x')")"
r "Externo: no puede borrar productos" "^0$" "$(q authenticated $EXT "with d as (delete from products returning 1) select count(*) from d")"
r "Externo: no puede usar la función del panel" "ERROR:.*no está habilitado" "$(q authenticated $EXT "select ajustar_stock_prueba('001', 1)")"
r "Externo: NO puede subir fotos" "ERROR:.*row-level security" "$(q authenticated $EXT "$INS_FOTO")"
r "Externo: NO puede reemplazar fotos" "^0$" "$(q authenticated $EXT "$UPD_FOTO")"
r "Externo: NO puede borrar fotos" "^0$" "$(q authenticated $EXT "$DEL_FOTO")"
r "Externo: tampoco con una política de lectura (la 007 cierra el riesgo latente)" "^0 0$" "$(q authenticated $EXT "$UPD_FOTO" "$CON_SELECT"; echo -n ' '; q authenticated $EXT "$DEL_FOTO" "$CON_SELECT")"
r "Externo: sigue sin leer ventas (sin cambios)" "^0$" "$(q authenticated $EXT "select count(*) from sales")"
r "Externo: puede ver el catálogo público como cualquier visitante" "^3$" "$(q authenticated $EXT "select count(*) from catalogo_tienda()")"

echo "== Usuario desactivado en el panel (Ayelen inactiva) =="
r "Inactivo: products vacío" "^0$" "$(q authenticated $AYELEN "select count(*) from products")"
r "Inactivo: NO puede subir fotos" "ERROR:.*row-level security" "$(q authenticated $AYELEN "$INS_FOTO")"
r "Inactivo: NO puede borrar fotos, ni con una política de lectura" "^0$" "$(q authenticated $AYELEN "$DEL_FOTO" "$CON_SELECT")"

echo "== Visitante sin sesión (tienda pública) =="
r "Visitante: catálogo completo (3 productos activos)" "^3$" "$(q anon - "select count(*) from catalogo_tienda()")"
r "Visitante: el catálogo no tiene columna de costo ni stock exacto" "^disponible,precio$|^precio,disponible$" "$(sql "select string_agg(parameter_name, ',' order by parameter_name) from information_schema.parameters where specific_name like 'catalogo_tienda%' and parameter_mode = 'OUT' and parameter_name in ('costo','stock','precio','disponible')")"
r "Visitante: datos del catálogo idénticos a antes" "^iguales$" "$(a=$(q anon - "$CAT"); [[ -n $a && $a == "$C0" ]] && echo iguales || echo "distintos ($a vs $C0)")"
r "Visitante: no lee products directo" "^0$" "$(q anon - "select count(*) from products")"
r "Visitante: no puede subir fotos" "ERROR:.*row-level security" "$(q anon - "$INS_FOTO")"
r "Visitante: no puede borrar fotos" "^0$" "$(q anon - "$DEL_FOTO" "$CON_SELECT")"

echo "== Sin efectos fuera de lo pedido =="
r "service_role (respaldos del servidor) lee todo" "^4$" "$(q service_role - "select count(*) from products")"
r "Otro bucket: el externo queda igual que antes (sin permiso, porque no tiene política propia)" "ERROR:.*row-level security" "$(q authenticated $EXT "insert into storage.objects (bucket_id, name) values ('otro-bucket', 'a.txt')")"
r "Las 3 fotos reales siguen intactas después de todos los intentos" "^3$" "$(sql "select count(*) from storage.objects")"
r "Los productos siguen intactos después de todos los intentos" "^4 34000$" "$(sql "select count(*) from products; select sum(costo) from products")"

echo "== Reversión =="
r "Reversión: aplica" "revertida" "$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$REV" 2>&1 | tail -1)"
r "Reversión: deja todo exactamente como antes de la 007" "^iguales$" "$( [[ $(huella) == "$H0" ]] && echo iguales || echo distintas)"
r "Reversión: el problema vuelve a estar (prueba de que la 007 era lo que lo cerraba)" "^4$" "$(q authenticated $EXT "select count(*) from products")"
r "Después de revertir, la 007 se puede volver a aplicar" "007 aplicada" "$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$M" 2>&1 | tail -1)"

echo "== Convivencia con migraciones anteriores =="
# La reversión de la 003 borra eldo_es_usuario_activo() (sin cascade, en una transacción). Con la 007 aplicada,
# PostgreSQL se niega a borrarla porque las políticas dependen de ella: no queda nada a medias.
r "Borrar eldo_es_usuario_activo() con la 007 aplicada se rechaza (dependencia)" "ERROR:.*depend" "$(sql "begin; drop function public.eldo_es_usuario_activo(); rollback;")"
r "…y no cambió nada" "^4$" "$(sql "select count(*) from pg_policies where policyname like 'eldo007%'")"
nueva_base
r "Aplicación en un solo envío (como el SQL Editor de Supabase)" "007 aplicada" "$(psql "$PGURL" -X -q -tA -c "$(cat "$M")" 2>&1 | tail -1)"
r "…con el mismo resultado: externo 0 productos, Diego y Niko 4, visitante 3" "^0 4 4 3$" "$(q authenticated $EXT "select count(*) from products"; echo -n ' '; q authenticated $DIEGO "select count(*) from products"; echo -n ' '; q authenticated $NIKO "select count(*) from products"; echo -n ' '; q anon - "select count(*) from catalogo_tienda()")"

echo "== ROLLBACK ante errores: nunca queda una aplicación parcial =="
# Se inyecta un error en 4 puntos y se ejecuta de 3 maneras. Después de cada intento la base tiene que
# quedar EXACTAMENTE como antes (0 políticas eldo007 y la misma huella).
inyectar() { # inyectar <punto> → copia del archivo con un error forzado en ese punto
  local f; f=$(mktemp --suffix=.sql)
  case $1 in
    tras_products) sed '/^-- 2. Fotos:/i do $$ begin raise exception '"'"'ERROR INYECTADO tras products'"'"'; end $$;' "$M" > "$f" ;;
    tras_subir)    sed '/^create policy eldo007_fotos_actualizar_habilitados/i do $$ begin raise exception '"'"'ERROR INYECTADO tras subir'"'"'; end $$;' "$M" > "$f" ;;
    tras_borrar)   sed '/^-- 3. Controles/i do $$ begin raise exception '"'"'ERROR INYECTADO tras borrar'"'"'; end $$;' "$M" > "$f" ;;
    en_controles)  sed 's/^  select count(\*) into v_total from public.products;/  raise exception '"'"'ERROR INYECTADO en controles'"'"';/' "$M" > "$f" ;;
  esac
  echo "$f"
}
for punto in tras_products tras_subir tras_borrar en_controles; do
  for modo in psql_se_detiene psql_sigue envio_unico; do
    nueva_base; H1=$(huella); f=$(inyectar $punto)
    grep -q "ERROR INYECTADO" "$f" || { mal=$((mal+1)); echo "[FALLA] no se pudo inyectar el error en $punto"; continue; }
    case $modo in
      psql_se_detiene) out=$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$f" 2>&1) ;;
      psql_sigue)      out=$(psql "$PGURL" -X -q -tA -f "$f" 2>&1) ;;
      envio_unico)     out=$(psql "$PGURL" -X -q -tA -c "$(cat "$f")" 2>&1) ;;
    esac
    n=$(sql "select count(*) from pg_policies where policyname like 'eldo007%'")
    est=$( [[ $n == 0 && $(huella) == "$H1" && $out != *"007 aplicada"* ]] && echo "sin cambios" || echo "CAMBIÓ (n=$n)")
    r "Error $punto · $modo" "^sin cambios$" "$est"
    rm -f "$f"
  done
done

echo
echo "Resultado: $ok correctas, $mal con falla."
[[ $mal -eq 0 ]]
