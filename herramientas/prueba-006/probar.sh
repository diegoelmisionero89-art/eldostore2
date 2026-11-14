#!/usr/bin/env bash
# Prueba la migración 006 en una base PostgreSQL DESCARTABLE (nunca en producción).
# Uso: PGURL=postgresql://postgres:x@127.0.0.1:55999/postgres herramientas/prueba-006/probar.sh
set -u
D=$(cd "$(dirname "$0")" && pwd); R=$(cd "$D/../.." && pwd)
: "${PGURL:?Falta PGURL (base descartable)}"
ok=0; mal=0
q() { # q <rol> <uid> <sql>  → salida o ERROR:mensaje
  local rol=$1 uid=$2 sql=$3
  psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -c "set prueba.uid = '$uid'; set role $rol; $sql" 2>&1 | sed -E 's/^psql:[^E]*ERROR: +/ERROR:/' | tr '\n' ' ' | sed 's/ *$//'
}
r() { # r <nombre> <esperado (regex)> <obtenido>
  if [[ $3 =~ $2 ]]; then ok=$((ok+1)); echo "[OK]    $1 → $3"; else mal=$((mal+1)); echo "[FALLA] $1 → esperado /$2/, obtenido: $3"; fi
}
ADM=11111111-1111-1111-1111-111111111111; NIKO=22222222-2222-2222-2222-222222222222

psql "$PGURL" -X -q -c "drop schema if exists auth cascade; drop schema public cascade; create schema public; grant usage on schema public to public;" >/dev/null 2>&1
psql "$PGURL" -X -q -v ON_ERROR_STOP=1 -f "$D/base-simulada.sql" >/dev/null || { echo "No se pudo crear la base simulada"; exit 1; }
antes=$(q postgres "" "select count(*) from catalogo_tienda()")

inst=$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$R/data/migracion-006-vendedores-asociados.sql" 2>&1 | tail -1)
r "Instalación" "instalada correctamente\|1\|0" "$inst"
r "Volver a instalar se niega sin cambiar nada" "ya existe|parece aplicada" "$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$R/data/migracion-006-vendedores-asociados.sql" 2>&1 | grep -o 'parece aplicada' | head -1)"

# Permisos
r "Visitante no lee las tablas directo" "ERROR:.*permission denied" "$(q anon "" "select count(*) from mkt_vendedores")"
r "Visitante no puede crear vendedores" "ERROR:.*permission denied" "$(q anon "" "select mkt_guardar_vendedor(null, '{\"nombre\":\"X\",\"whatsapp\":\"5493751000000\"}')")"
r "Usuario no administrador no puede crear vendedores" "ERROR:.*Solo el administrador" "$(q authenticated $NIKO "select mkt_guardar_vendedor(null, '{\"nombre\":\"X\",\"whatsapp\":\"5493751000000\"}')")"
r "WhatsApp inválido se rechaza" "ERROR:.*entre 10 y 15" "$(q authenticated $ADM "select mkt_guardar_vendedor(null, '{\"nombre\":\"Mal\",\"whatsapp\":\"123\"}')")"

# Vendedores
v1=$(q authenticated $ADM "select mkt_guardar_vendedor(null, '{\"nombre\":\"Perfumes Ñandú Árabe\",\"whatsapp\":\"+54 9 3751 11-2233\",\"descripcion\":\"Perfumes árabes originales\",\"localidad\":\"Eldorado\",\"activo\":true}')->>'id'")
r "Crear vendedor (admin)" "^[0-9a-f-]{36}$" "$v1"
r "Dirección de la tienda y WhatsApp normalizados" "^perfumes-nandu-arabe\|5493751112233\|10.00$" "$(q postgres "" "select slug||'|'||whatsapp||'|'||comision_pct from mkt_vendedores where id='$v1'")"
v2=$(q authenticated $ADM "select mkt_guardar_vendedor(null, '{\"nombre\":\"Herramientas Km 9\",\"whatsapp\":\"5493757000111\",\"comision_pct\":\"12\"}')->>'id'")
r "Vendedor nuevo queda inactivo por defecto" "^f$" "$(q postgres "" "select activo from mkt_vendedores where id='$v2'")"

# Productos
p1=$(q authenticated $ADM "select mkt_guardar_producto(null, jsonb_build_object('vendedor_id','$v1','nombre','Perfume Lattafa 100 ml','precio',45000,'stock',4,'categoria','Perfumes','fotos',jsonb_build_array('https://ejemplo.invalid/a.jpg','https://ejemplo.invalid/b.jpg')))")
r "Crear producto asociado con código automático" '"codigo": "TA0001"' "$p1"
p1id=$(echo "$p1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
p2=$(q authenticated $ADM "select mkt_guardar_producto(null, jsonb_build_object('vendedor_id','$v2','codigo','HK-10','nombre','Taladro 500 W','precio',80000,'stock',1))->>'id'")
r "Código repetido se rechaza" "ERROR:.*Ya hay otro producto" "$(q authenticated $ADM "select mkt_guardar_producto(null, jsonb_build_object('vendedor_id','$v2','codigo','hk-10','nombre','Otro','precio',1))")"
r "Precio 0 se rechaza" "ERROR:.*mayor que 0" "$(q authenticated $ADM "select mkt_guardar_producto(null, jsonb_build_object('vendedor_id','$v2','nombre','Otro','precio',0))")"
r "Producto nuevo queda pendiente y NO se publica" '"productos": \[\]' "$(q anon "" "select tiendas_asociadas()")"
q authenticated $ADM "select mkt_estado_producto('$p1id','aprobado')" >/dev/null
q authenticated $ADM "select mkt_estado_producto('$p2','aprobado')" >/dev/null
pub=$(q anon "" "select tiendas_asociadas()")
r "Aprobado + vendedor activo → publicado (con sus 2 fotos)" "a\.jpg\", \"https://ejemplo\.invalid/b\.jpg.*Lattafa" "$pub"
r "Producto de vendedor INACTIVO no se publica" "^[^T]*$" "$(echo "$pub" | grep -o 'Taladro' || true)"
r "La tienda pública no recibe stock exacto, notas ni comisión" "^$" "$(echo "$pub" | grep -oE '"stock"|"notas"|comision' | head -1)"
r "«Todos los productos» (catalogo_tienda) no cambia" "^$antes$" "$(q anon "" "select count(*) from catalogo_tienda()")"
r "Usuario no administrador no aprueba productos" "ERROR:.*Solo el administrador" "$(q authenticated $NIKO "select mkt_estado_producto('$p2','pausado')")"
r "Usuario activo puede ver el panel (solo lectura)" '"esAdmin": false' "$(q authenticated $NIKO "select mkt_panel()")"
r "Visitante no ve el panel" "ERROR:.*permission denied" "$(q anon "" "select mkt_panel()")"

# Ventas y comisión
s1=$(q authenticated $ADM "select mkt_registrar_venta(jsonb_build_object('producto_id','$p1id','cantidad',2,'cliente','Ana'))")
r "Venta: total, comisión 10 % y parte del vendedor" '"total": 90000.*"comision": 9000.*"monto_vendedor": 81000' "$s1"
r "La venta descuenta el stock del producto asociado" "^2$" "$(q postgres "" "select stock from mkt_productos where id='$p1id'")"
r "Stock insuficiente se rechaza" "ERROR:.*Stock insuficiente" "$(q authenticated $ADM "select mkt_registrar_venta(jsonb_build_object('producto_id','$p1id','cantidad',3))")"
q authenticated $ADM "select mkt_guardar_vendedor('$v1', '{\"nombre\":\"Perfumes Ñandú Árabe\",\"whatsapp\":\"5493751112233\",\"comision_pct\":\"15\",\"activo\":true}')" >/dev/null
r "Cambiar el % no altera ventas anteriores" "^10.00\|9000.00$" "$(q postgres "" "select comision_pct||'|'||comision from mkt_ventas")"
r "Editar el nombre no cambia la dirección de su tienda" "^perfumes-nandu-arabe$" "$(q postgres "" "select slug from mkt_vendedores where id='$v1'")"
s2=$(q authenticated $ADM "select mkt_registrar_venta(jsonb_build_object('producto_id','$p1id','cantidad',1,'precio_unitario',43333))")
r "Venta nueva usa el % nuevo (15 %, al peso) y suma exacta" '"total": 43333.*"comision": 6500.*"monto_vendedor": 36833' "$s2"
s2id=$(echo "$s2" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
r "Anular sin motivo se rechaza" "ERROR:.*motivo" "$(q authenticated $ADM "select mkt_anular_venta('$s2id','')")"
q authenticated $ADM "select mkt_anular_venta('$s2id','Cliente desistió')" >/dev/null
r "Anular devuelve el stock y conserva la venta" "^2\|2\|1$" "$(q postgres "" "select (select stock from mkt_productos where id='$p1id')||'|'||count(*)||'|'||count(*) filter (where anulada) from mkt_ventas")"
r "Anular dos veces se rechaza" "ERROR:.*ya estaba anulada" "$(q authenticated $ADM "select mkt_anular_venta('$s2id','otra vez')")"
s1id=$(echo "$s1" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
q authenticated $ADM "select mkt_comision_cobrada('$s1id', true)" >/dev/null
r "Marcar comisión cobrada" "^t$" "$(q postgres "" "select comision_cobrada from mkt_ventas where id='$s1id'")"
r "Borrar un producto con ventas se rechaza" "ERROR:.*pausalo" "$(q authenticated $ADM "select mkt_eliminar_producto('$p1id')")"
r "Borrar un producto sin ventas" '"ok": true' "$(q authenticated $ADM "select mkt_eliminar_producto('$p2')")"
r "Todo queda registrado en audit_log" "^[1-9][0-9]*$" "$(q postgres "" "select count(*) from audit_log where tabla like 'mkt_%'")"
r "Nada de la tienda propia cambió (products)" "^1\|15000\|3$" "$(q postgres "" "select count(*)||'|'||max(precio)::int||'|'||max(stock) from products")"

# Reversión
r "Revertir se niega si hay datos" "ERROR:.*Hay vendedores" "$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$R/data/migracion-006-revertir.sql" 2>&1 | sed -E 's/^psql:[^E]*ERROR: +/ERROR:/' | head -1)"
CONF=$(mktemp); trap 'rm -f "$CONF"' EXIT
sed 's/v_confirmar boolean := false/v_confirmar boolean := true/' "$R/data/migracion-006-revertir.sql" > "$CONF"
r "Revertir confirmado deja todo como antes" "revertida" "$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$CONF" 2>&1 | tail -1)"
r "Después de revertir no queda nada de la 006" "^0$" "$(q postgres "" "select count(*) from pg_class where relname like 'mkt\_%' and relnamespace='public'::regnamespace")"
r "Se puede volver a instalar después de revertir" "instalada correctamente" "$(psql "$PGURL" -X -q -tA -v ON_ERROR_STOP=1 -f "$R/data/migracion-006-vendedores-asociados.sql" 2>&1 | tail -1)"

echo; echo "Resultado: $ok correctas, $mal con falla."
[ $mal -eq 0 ]
