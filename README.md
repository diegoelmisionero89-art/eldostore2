# ELDOSTORE — Panel administrativo + sitio público

Base: versión recuperada de `Eldozip.zip` (archivos del 6–10/09/2026).
**Actualización 002 (25/10/2026):** ventas propias / por revendedor con comisión,
y anulación y corrección de ventas, compras y gastos.

## Qué hay de nuevo (actualización 002)

**Modalidad de venta (obligatoria)**
- *Venta propia*: precio normal del producto, sin comisión. Ganancia bruta = importe − costo.
- *Venta por revendedor*: se carga el % del revendedor en cada producto (puede variar
  entre productos y entre ventas). Comisión por línea = precio unitario × cantidad × % / 100.
  El formulario muestra importe, costo, %, comisión y ganancia bruta de ELDOSTORE.
- El % y el importe de comisión quedan guardados en cada línea de la venta, y el total en
  `sales.comision_total`. Si el % cambia en el futuro, el historial no se altera.
- Caja: la venta registra el ingreso por el total y un egreso "comision_revendedor" por la comisión.
- Ventas anteriores: quedan como venta propia, comisión 0. **Sin comisiones retroactivas.**
- Pedidos convertidos en venta: se registran como venta propia (sin comisión), igual que antes.

**Historial y reportes**
- Ventas: resumen separado (propias, revendedor, comisiones, ganancia bruta total), filtro por
  modalidad y opción "Mostrar anuladas".
- Reportes: tabla "Ventas por modalidad" y KPIs de comisiones y ganancia bruta después de comisiones.
- Dashboard: "Comisiones del mes". Ganancia = ganancia bruta después de comisiones.
- Las operaciones anuladas no cuentan en dashboard, reportes ni historial de clientes.

**Anular y corregir (ventas, compras y gastos)**
- Nada se borra. *Anular* marca la operación como anulada (con motivo y fecha) y revierte sus efectos:
  - Venta: devuelve el stock, revierte el ingreso y la comisión en caja. Si venía de un pedido,
    el pedido vuelve a "Pendiente" y se puede volver a convertir (sin duplicar).
  - Compra: resta del stock las unidades que sumó y revierte el pago. Si esas unidades ya se
    vendieron, no deja anular (usá "Corregir").
  - Gasto: revierte su egreso.
- *Corregir* = anular la original + registrar la versión correcta, en una sola transacción.
  La nueva queda vinculada a la original (`corrige_a`). Una venta corregida conserva el costo
  histórico de sus productos.

## Archivos

| Archivo | Estado |
|---|---|
| `admin.html` | Modificado: ventas, compras, gastos, reportes; texto de respaldo corregido |
| `css/admin.css` | Modificado: solo se agregaron estilos al final |
| `js/db.js` | Modificado: funciones nuevas; lo existente se conserva |
| `js/ui.js` | Modificado: ventas, compras, gastos, reportes y dashboard |
| `js/supabase-config.js` | Sin URL ni clave (hay que completarlo, ver abajo) |
| `data/migracion-002-chequeo-previo.sql` | Nuevo. Solo lectura |
| `data/migracion-002-revendedores-y-correcciones.sql` | Nuevo. La migración |
| `data/migracion-002-revertir.sql` | Nuevo. Reversión |
| `data/seguridad-revision.sql` | Revisión de permisos de las funciones originales |
| `index.html`, `js/auth.js`, `data/schema-supabase.sql`, `data/inventario-real.js`, `data/plantilla-inventario.csv` | Sin cambios |

## Qué es frontend y qué requiere migración

- **Solo frontend** (se publica subiendo la carpeta): formulario de venta con modalidad y %,
  vista previa de importes, resumen y filtros del historial, reportes por modalidad, KPI de
  comisiones, botones Anular/Corregir, formato para celular.
- **Requiere la migración 002** (base de datos): columnas `modalidad`, `comision_total`,
  `anulada`, `anulada_el`, `motivo_anulacion`, `corrige_a`, y las funciones
  `register_sale_v2`, `void_sale`, `correct_sale`, `void_purchase`, `correct_purchase`,
  `void_expense`, `correct_expense`. Sin la migración, el panel nuevo muestra el aviso
  "Falta aplicar la migración" y no registra ventas.
- **No cambia:** tablas existentes y sus filas, `register_sale`, `register_purchase`,
  `convert_order_to_sale`, políticas RLS y permisos que ya ajustaste.

## Cómo aplicar la actualización (en este orden)

1. **Respaldo:** en el panel actual, Configuración → *Descargar respaldo (JSON)*.
2. **Chequeo previo:** en Supabase → SQL Editor, correr las 3 consultas de
   `data/migracion-002-chequeo-previo.sql` de a una. Anotar los números de la consulta 0c.
3. **Migración:** pegar **todo** `data/migracion-002-revendedores-y-correcciones.sql` → Run.
   Va en una transacción: si algo falla, no se aplica nada.
4. **Control:** volver a correr la consulta 0c. Tiene que dar **exactamente** los mismos números.
5. **Configurar:** en `js/supabase-config.js` pegar la Project URL y la clave *publishable*
   (las mismas que usa tu panel publicado). Nunca la `service_role` ni la `sb_secret_...`.
6. **Publicar** la carpeta como siempre (ver `docs/PUBLICAR.md`).

**No volver a correr `schema-supabase.sql`.** La migración no lo necesita.

Orden seguro: si se publica el panel nuevo antes de migrar, no se dañan datos; solo avisa
"Falta aplicar la migración" al registrar. Si se migra y el panel viejo sigue publicado,
el panel viejo sigue funcionando igual (sus funciones no se modificaron).

## Cómo probar sin afectar ventas reales

**Opción A (la más segura): un proyecto de prueba aparte.**
Crear un segundo proyecto en Supabase (por ejemplo `eldostore-pruebas`). Correr ahí
`schema-supabase.sql` y luego la migración 002, crear un usuario en Authentication → Users,
y abrir una copia local del panel con la URL y la clave de ese proyecto. Se puede probar
todo sin tocar la base real.

**Opción B: en la base real, con un producto de prueba.**
1. Crear un producto "PRUEBA — NO VENDER" con costo 50.000, precio 100.000 y stock 5.
2. Registrar una venta por revendedor: 2 unidades al 10 %. Debe mostrar total $200.000,
   costo $100.000, comisión $20.000 y ganancia $80.000.
3. Probar *Corregir* (por ejemplo, cambiar a 5 %) y después *Anular* la venta corregida.
4. Verificar: el stock vuelve a 5 y en Caja los movimientos de esas ventas suman 0.
   Las ventas de prueba quedan registradas como anuladas (visibles con "Mostrar anuladas")
   y no cuentan en reportes.
5. Poner el stock del producto de prueba en 0 o eliminarlo.

No usar compras de prueba en la base real: quedan vinculadas al producto.

## Volver atrás

`data/migracion-002-revertir.sql`: el Paso A muestra qué información nueva existe; el Paso B
quita columnas y funciones nuevas. Si ya hubo ventas por revendedor o anulaciones, leer la
advertencia del archivo antes de revertir. Después, publicar de nuevo el panel anterior.

## Seguridad

- Las funciones nuevas solo las puede ejecutar un usuario con sesión iniciada: no están
  habilitadas para el rol `anon` y además verifican `auth.uid()`.
- Las 3 funciones originales (`register_sale`, `register_purchase`, `convert_order_to_sale`)
  siguen ejecutables por `anon` hasta que se aplique la Parte 2 de `data/seguridad-revision.sql`.
- Revisar en Authentication que "Allow new users to sign up" esté desactivado.

## Verificación realizada (en un Postgres 16 local, no en Supabase)

- Esquema idéntico a `schema-supabase.sql` + datos de ejemplo creados con las funciones originales.
- Migración aplicada con y sin la corrección de seguridad, y dos veces seguidas: sin errores.
- La migración no cambia conteos, saldo de caja, stock ni ganancia histórica.
- 52 pruebas SQL (con y sin la corrección de seguridad aplicada): ejemplo del 10 %, % distinto por línea, validaciones, anular y corregir
  ventas, compras y gastos, pedidos, costo histórico, permisos de `anon`, coherencia de caja.
- 20 pruebas del panel en navegador (Chromium) conectado a esa base, sin errores de JavaScript.
- Cruce de código vs base: las 9 llamadas RPC del panel coinciden en nombre y parámetros con
  las funciones, y las 93 columnas que el panel lee o escribe existen.
- Reversión: deja exactamente las mismas funciones y columnas que antes de migrar.

## Pendiente / limitaciones

- No se registra el nombre del revendedor ni el pago de comisiones por revendedor.
- Los pedidos no tienen modalidad: al convertirlos se registran como venta propia. Si un pedido
  era de un revendedor, se puede *Corregir* la venta resultante.
- El precio de venta se toma del producto. Al corregir se conserva el precio original de cada línea.
- El sitio público (`index.html`) sigue siendo un catálogo estático.
