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
# --- Caja: la comisión cobrada entra como ingreso de ELDOSTORE (estructura real de cash_movements) ---
CAJA0=$(q postgres "" "select count(*)||'|'||md5(string_agg(id::text||tipo||origen||monto||coalesce(ref_id::text,''), ',' order by id)) from cash_movements")
r "Comisión pendiente: no entra nada a la caja" "^0$" "$(q postgres "" "select count(*) from cash_movements where origen = 'comision_asociado'")"
q authenticated $ADM "select mkt_comision_cobrada('$s1id', true)" >/dev/null
r "Cobrada: un ingreso por la COMISIÓN (no el total), cuenta ELDOSTORE, custodio Diego, con la referencia de la venta" \
  "^ingreso\|9000\|eldostore\|diego\|true\|true$" \
  "$(q postgres "" "select c.tipo||'|'||c.monto::int||'|'||a.codigo||'|'||h.codigo||'|'||(c.ref_id = '$s1id')||'|'||(v.comision_mov_id = c.id) from cash_movements c join accounts a on a.id=c.account_id join cash_holders h on h.id=c.holder_id join mkt_ventas v on v.id=c.ref_id where c.origen='comision_asociado'")"
r "La descripción indica vendedor, producto, código y fecha de la venta" "Comisión 10 % de Perfumes Ñandú Árabe · 2 × Perfume Lattafa 100 ml \(TA0001\) · venta asociada de [0-9]{2}/[0-9]{2}/[0-9]{4}" \
  "$(q postgres "" "select descripcion from cash_movements where origen='comision_asociado'")"
r "Marcarla cobrada otra vez se rechaza (sin duplicar)" "ERROR:.*ya está registrada" "$(q authenticated $ADM "select mkt_comision_cobrada('$s1id', true)")"
r "Sigue habiendo un solo ingreso de esa comisión" "^1$" "$(q postgres "" "select count(*) from cash_movements where origen='comision_asociado' and ref_id='$s1id'")"
r "Usuario no administrador no puede marcar comisiones" "ERROR:.*Solo el administrador" "$(q authenticated $NIKO "select mkt_comision_cobrada('$s1id', false)")"
r "Custodio inválido se rechaza" "ERROR:.*custodio" "$(q authenticated $ADM "select mkt_comision_cobrada('$s1id', false, gen_random_uuid())")"
q authenticated $ADM "select mkt_comision_cobrada('$s1id', false)" >/dev/null
r "Volver a «por cobrar»: contramovimiento (egreso con anula_a), el ingreso no se borra" "^2\|0\|false$" \
  "$(q postgres "" "select count(*)||'|'||sum(case when tipo='ingreso' then monto else -monto end)::int||'|'||(select comision_cobrada from mkt_ventas where id='$s1id') from cash_movements where origen='comision_asociado' and (anula_a is null or anula_a in (select id from cash_movements where ref_id='$s1id'))")"
NIKOH=$(q postgres "" "select id from cash_holders where codigo='niko'")
q authenticated $ADM "select mkt_comision_cobrada('$s1id', true, '$NIKOH')" >/dev/null
r "Cobrarla de nuevo: un ingreso nuevo, con quien recibió el dinero (Niko)" "^niko\|9000$" \
  "$(q postgres "" "select h.codigo||'|'||c.monto::int from mkt_ventas v join cash_movements c on c.id=v.comision_mov_id join cash_holders h on h.id=c.holder_id where v.id='$s1id'")"
r "Saldo de comisiones en caja = una sola comisión vigente" "^9000$" "$(q postgres "" "select sum(case when tipo='ingreso' then monto else -monto end)::int from cash_movements where origen='comision_asociado'")"
# --- Indicadores (mkt_indicadores): separados, sin doble conteo, solo administrador ---
s3=$(q authenticated $ADM "select mkt_registrar_venta(jsonb_build_object('producto_id','$p1id','cantidad',1))")
r "Venta pendiente nueva (15 %)" '"total": 45000.*"comision": 6750' "$s3"
IND=$(q authenticated $ADM "select mkt_indicadores()")
ind() { echo "$IND" | python3 -c "import json,sys;d=json.load(sys.stdin);print(int(float(d['$1'])))"; }
r "Generadas = cobradas + pendientes (9.000 + 6.750 = 15.750), sin la venta anulada" "^15750\|9000\|6750\|2$" "$(ind generadas)|$(ind cobradas)|$(ind pendientes)|$(ind ventas)"
r "La comisión cobrada no se cuenta dos veces aunque esté en la caja" "^15750$" "$(ind generadas)"
r "Ventas de los asociados aparte (no son ingreso de ELDOSTORE): 135.000; para vendedores 119.250" "^135000\|119250$" "$(ind ventas_vendedores)|$(ind para_vendedores)"
r "ESCENARIO: generadas 15.750 · cobradas 9.000 · pendientes 6.750 · ingresos efectivos 9.000" "^15750\|9000\|6750\|9000$" \
  "$(ind generadas)|$(ind cobradas)|$(ind pendientes)|$(ind ingresos_efectivos)"
r "Ingresos efectivos = lo que entró a la caja por comisiones (nunca las pendientes)" "^9000$" \
  "$(q postgres "" "select sum(case when tipo='ingreso' then monto else -monto end)::int from cash_movements where origen='comision_asociado'")"
s3id=$(echo "$s3" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
q authenticated $ADM "select mkt_comision_cobrada('$s3id', true)" >/dev/null
IND=$(q authenticated $ADM "select mkt_indicadores()")
r "ESCENARIO: al cobrar después los 6.750 → ingresos efectivos 15.750, cobradas 15.750, pendientes 0, generadas 15.750" "^15750\|15750\|0\|15750$" \
  "$(ind generadas)|$(ind cobradas)|$(ind pendientes)|$(ind ingresos_efectivos)"
r "Los 9.000 anteriores no se duplicaron: un solo ingreso vigente por venta (9.000 y 6.750)" "^6750,9000$" \
  "$(q postgres "" "select string_agg(monto::int::text, ',' order by monto) from cash_movements c where origen='comision_asociado' and tipo='ingreso' and not exists (select 1 from cash_movements x where x.anula_a = c.id)")"
r "Volver a cobrar la de 9.000 se rechaza (no se duplica)" "ERROR:.*ya está registrada" "$(q authenticated $ADM "select mkt_comision_cobrada('$s1id', true)")"
r "Filtro por vendedor (el otro vendedor no tiene ventas)" '"generadas": 0' "$(q authenticated $ADM "select mkt_indicadores(null, null, '$v2')")"
r "Filtro por fecha (hasta ayer: nada)" '"generadas": 0' "$(q authenticated $ADM "select mkt_indicadores(null, (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, null)")"
r "Filtro por fecha (hoy: todo)" '"generadas": 15750' "$(q authenticated $ADM "select mkt_indicadores((now() at time zone 'America/Argentina/Buenos_Aires')::date, (now() at time zone 'America/Argentina/Buenos_Aires')::date, null)")"
r "Fechas invertidas se rechazan" "ERROR:.*anterior" "$(q authenticated $ADM "select mkt_indicadores('2026-12-01', '2026-11-01', null)")"
r "Por vendedor (ya cobrado todo): generadas, cobradas y pendientes" '"cobradas": 15750.*"generadas": 15750.*"pendientes": 0' "$(echo "$IND" | python3 -c 'import json,sys;print(json.dumps(json.load(sys.stdin)["por_vendedor"][0], sort_keys=True))')"
r "Usuario no administrador NO ve los indicadores" "ERROR:.*Solo el administrador" "$(q authenticated $NIKO "select mkt_indicadores()")"
r "Usuario no administrador NO ve ventas ni comisiones en el panel" '"ventas": \[\]' "$(q authenticated $NIKO "select mkt_panel()")"
r "Usuario no administrador NO lee la tabla de ventas asociadas" "^0$" "$(q authenticated $NIKO "select count(*) from mkt_ventas")"
r "El administrador sí la lee" "^3$" "$(q authenticated $ADM "select count(*) from mkt_ventas")"
r "Visitante no puede pedir indicadores" "ERROR:.*permission denied" "$(q anon "" "select mkt_indicadores()")"
q authenticated $ADM "select mkt_anular_venta('$s1id','Devolución del cliente')" >/dev/null
r "Anular una venta con comisión cobrada la saca de la caja (contramovimiento) y la deja anulada" "^0\|true\|false$" \
  "$(q postgres "" "select (select sum(case when tipo='ingreso' then monto else -monto end)::int from cash_movements where origen='comision_asociado' and ref_id='$s1id')||'|'||anulada||'|'||comision_cobrada from mkt_ventas where id='$s1id'")"
IND=$(q authenticated $ADM "select mkt_indicadores()")
r "Después de anular la de 9.000: ingresos efectivos 6.750 (solo lo que sigue en caja)" "^6750\|6750\|0$" "$(ind ingresos_efectivos)|$(ind generadas)|$(ind pendientes)"
r "Comisión de venta anulada no se puede cobrar" "ERROR:.*anulada" "$(q authenticated $ADM "select mkt_comision_cobrada('$s1id', true)")"
r "Los movimientos de caja ANTERIORES no cambiaron" "^$CAJA0$" "$(q postgres "" "select count(*)||'|'||md5(string_agg(id::text||tipo||origen||monto||coalesce(ref_id::text,''), ',' order by id)) from cash_movements where origen <> 'comision_asociado'")"
r "En la caja nunca entra el total de una venta asociada" "^0$" "$(q postgres "" "select count(*) from cash_movements c join mkt_ventas v on v.id=c.ref_id where c.monto = v.total and v.total <> v.comision")"
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
