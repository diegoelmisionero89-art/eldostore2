# Vendedores asociados V1 — guía de instalación y uso

Rama: `vendedores-asociados-v1`. **No está publicada ni instalada en producción.**

## Qué agrega

| Parte | Archivo | Qué hace |
|---|---|---|
| Base de datos | `data/migracion-006-vendedores-asociados.sql` | 4 tablas nuevas (`mkt_vendedores`, `mkt_productos`, `mkt_producto_fotos`, `mkt_ventas`) y sus funciones. Solo agrega. |
| Reversión | `data/migracion-006-revertir.sql` | Quita solo lo de la 006. Se niega si hay datos cargados. |
| Panel | `js/asociados.js`, `admin.html`, `admin.css`, cambios mínimos en `js/ui.js`, `js/db.js`, `js/imagenes.js` | Menú «🏪 Tiendas asociadas»: vendedores, productos (con aprobación), ventas y comisiones. |
| Tienda | `js/asociadas.js`, `index.html`, `css/tienda.css` | Sección «Tiendas asociadas», tienda de cada vendedor, ficha y pedido por WhatsApp al vendedor. |
| Pruebas | `herramientas/prueba-006/` | Prueba de la base (66 controles) y de punta a punta en navegador (31 controles), en una base descartable con la caja real (cuentas, custodios y anulaciones). |

Lo que **no** toca: `products`, precios, stock, ventas, compras, gastos, cuentas, usuarios,
promociones, `catalogo_tienda()` ni `promociones_tienda()`. De la caja no cambia estructura ni
movimientos existentes: solo **agrega** el ingreso de cada comisión cobrada (ver abajo). Los productos de vendedores nunca entran
en «Todos los productos», en el buscador ni en el carrito de ELDOSTORE.

Sin la migración instalada, el panel y la tienda se ven exactamente como hoy (el menú y la sección
aparecen solos cuando la base tiene la 006).

## Reglas

- **Vendedor nuevo:** queda **inactivo** hasta que lo actives. Inactivo = su tienda no se ve.
- **Producto nuevo:** queda **pendiente**. Se publica cuando lo aprobás **y** su vendedor está activo.
  Se puede pausar, rechazar o volver a publicar. Sin stock se muestra «Sin stock» y no se puede pedir.
- **Pedido:** el cliente arma un pedido por tienda y lo envía al **WhatsApp del vendedor** con vendedor,
  producto, código, cantidad, precio y total. Pago y entrega los coordina el vendedor.
- **Comisión:** 10 % inicial, configurable por vendedor (0 a 50 %). Se copia en cada venta al
  registrarla: cambiarla no altera las ventas anteriores. Comisión = total × % ÷ 100, al peso;
  al vendedor = total − comisión. La calcula la base, no el navegador.
- **Ventas asociadas:** se registran desde el panel (descuentan el stock del producto asociado) y se
  **anulan con motivo** (devuelven el stock). Nunca se borran. El total de la venta no entra a la caja
  ni a las ventas propias de ELDOSTORE.

## Comisión cobrada → caja de ELDOSTORE

Al tocar **Marcar cobrada** (el panel pregunta quién recibió el dinero), la base agrega en
`cash_movements`, con la misma estructura que el resto de la caja:

| Campo | Valor |
|---|---|
| `tipo` | `ingreso` |
| `origen` | `comision_asociado` |
| `monto` | la comisión de ELDOSTORE (nunca el total de la venta) |
| `descripcion` | «Comisión 10 % de *vendedor* · 2 × *producto* (*código*) · venta asociada de dd/mm/aaaa» |
| `ref_id` | id de la venta asociada (`mkt_ventas.id`) |
| `account_id` | cuenta ELDOSTORE |
| `holder_id` | quién recibió el dinero (por defecto, quien lo marca) |
| `fecha` / `creado_por` | momento del cobro y usuario |

La venta asociada guarda `comision_cobrada_en` y `comision_mov_id` (el movimiento de caja).

- **Pendiente:** no entra nada a la caja.
- **Sin duplicados:** la venta se bloquea al marcarla y la base rechaza un segundo cobro si ya hay un
  ingreso vigente de esa venta (doble clic, dos dispositivos o volver a abrirla).
- **Volver a «por cobrar»** o **anular** una venta con la comisión cobrada: no se borra el ingreso; se
  agrega el contramovimiento (`egreso`, mismo origen, `anula_a` = el ingreso), igual que las anulaciones
  de ventas propias. Si después se cobra de nuevo, entra un ingreso nuevo.
- El saldo de la caja y el «saldo de caja» de la cuenta ELDOSTORE (pantalla Cuentas) lo incluyen; la
  «ganancia» de Cuentas (basada en ventas propias) no cambia.
- La reversión de la 006 no borra estos movimientos: son dinero real que entró.
- **Permisos:** solo el administrador (`app_users.es_admin`) crea, edita, aprueba y registra. Los demás
  usuarios activos del panel solo ven. La tienda pública solo lee `tiendas_asociadas()`, que no envía
  stock exacto, notas internas, comisiones ni ventas.
- **Fotos:** se optimizan solas antes de subir (logos 400 px en `vendedores/`, productos 1200 px en
  `asociados/`, dentro del bucket `productos-fotos`). El sistema de respaldos ya las incluye.

## Indicadores (solo administrador)

Los calcula la base con `mkt_indicadores(desde, hasta, vendedor)`, solo para el administrador. Se ven en
**Tiendas asociadas → Ventas y comisiones** (filtros: vendedor, desde, hasta) y en **Reportes** (panel
«Ingresos de ELDOSTORE: ventas propias + Marketplace», con las fechas del reporte y filtro de vendedor).

| Indicador | Cómo se calcula |
|---|---|
| Ganancia por ventas propias | El cálculo de siempre de Reportes (ganancia bruta), sin cambios |
| Comisiones generadas | Suma de comisiones de las ventas asociadas del período, sin anuladas |
| Comisiones cobradas | De esas, las marcadas «cobradas» (son las que entraron a la caja) |
| Comisiones pendientes | De esas, las que falta cobrar. Generadas = cobradas + pendientes |
| Ingresos por ventas propias | Ventas de la tienda del reporte (propias y por revendedor) |
| Ingresos por comisiones del Marketplace | Comisiones generadas |
| Ingresos totales de ELDOSTORE | Ventas propias + comisiones. Las ventas completas de los asociados NO se suman |
| Vendido por los asociados | Solo informativo (no es ingreso de ELDOSTORE) |
| Control de caja | Lo que entró a la caja por comisiones en el período, por fecha de cobro |

Sin doble conteo: los indicadores salen de `mkt_ventas` (una fila por venta); el movimiento de caja es
solo el registro del cobro y no se suma otra vez. Los usuarios que no son administradores no ven ventas
asociadas, comisiones ni indicadores (ni por el panel ni leyendo la tabla).

## Poner en producción (cada paso con autorización de Diego)

1. **Respaldo:** descargar el respaldo JSON del panel (Configuración → Descargar respaldo).
2. **Migración:** Supabase → SQL Editor → pegar **todo** `data/migracion-006-vendedores-asociados.sql`
   → Run. Tiene que terminar en «Migración 006 instalada correctamente», con la cantidad de productos
   propios igual a la de antes y 0 tiendas asociadas. Si algo falla, no se cambia nada.
3. **Control (solo lectura):**
   ```sql
   select count(*) from public.catalogo_tienda();        -- igual que antes de instalar
   select public.tiendas_asociadas();                     -- {"productos": [], "vendedores": []}
   select count(*) from pg_policies where tablename like 'mkt\_%';   -- 4
   select count(*) from public.cash_movements where origen = 'comision_asociado';   -- 0
   ```
4. **Publicar el código:** integrar la rama `vendedores-asociados-v1` en `main` (GitHub Pages publica solo).
   El orden importa poco: sin la migración, el código nuevo no muestra nada.
5. **Prueba real:** en el panel crear un vendedor de prueba **inactivo**, un producto, aprobarlo; activar el
   vendedor, abrir `https://eldostore.com.ar/#tiendas/<su-tienda>` y enviar un pedido de prueba a tu propio
   WhatsApp. Después desactivarlo (o editarlo con los datos reales).

**Volver atrás:** quitar el código (revertir el commit en `main`) y, si hace falta, correr
`data/migracion-006-revertir.sql` (se niega si hay vendedores o ventas cargados: primero respaldarlos).

## Repetir las pruebas (base descartable, nunca producción)

```bash
# PostgreSQL local descartable en el puerto 55998
PGURL=postgresql://postgres@127.0.0.1:55998/postgres PGPASSWORD=x herramientas/prueba-006/probar.sh
python3 herramientas/prueba-006/servidor.py 8099 &      # tienda y panel contra esa base
node herramientas/prueba-006/e2e.js http://127.0.0.1:8099 capturas
```

## Pendiente para etapas siguientes

- Panel propio para que cada vendedor cargue sus productos (V2).
- Ficha para compartir con vista previa (`/p/<código>/`) para productos asociados.
