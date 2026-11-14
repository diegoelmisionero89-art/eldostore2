# Vendedores asociados V1 — guía de instalación y uso

Rama: `vendedores-asociados-v1`. **No está publicada ni instalada en producción.**

## Qué agrega

| Parte | Archivo | Qué hace |
|---|---|---|
| Base de datos | `data/migracion-006-vendedores-asociados.sql` | 4 tablas nuevas (`mkt_vendedores`, `mkt_productos`, `mkt_producto_fotos`, `mkt_ventas`) y sus funciones. Solo agrega. |
| Reversión | `data/migracion-006-revertir.sql` | Quita solo lo de la 006. Se niega si hay datos cargados. |
| Panel | `js/asociados.js`, `admin.html`, `admin.css`, cambios mínimos en `js/ui.js`, `js/db.js`, `js/imagenes.js` | Menú «🏪 Tiendas asociadas»: vendedores, productos (con aprobación), ventas y comisiones. |
| Tienda | `js/asociadas.js`, `index.html`, `css/tienda.css` | Sección «Tiendas asociadas», tienda de cada vendedor, ficha y pedido por WhatsApp al vendedor. |
| Pruebas | `herramientas/prueba-006/` | Prueba de la base (38 controles) y de punta a punta en navegador (23 controles), en una base descartable. |

Lo que **no** toca: `products`, precios, stock, ventas, compras, gastos, caja, cuentas, usuarios,
promociones, `catalogo_tienda()` ni `promociones_tienda()`. Los productos de vendedores nunca entran
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
- **Ventas asociadas:** se registran desde el panel (descuentan el stock del producto asociado), se
  marcan «comisión cobrada» cuando el vendedor paga, y se **anulan con motivo** (devuelven el stock).
  Nunca se borran. No se suman a la caja ni a las cuentas de ELDOSTORE.
- **Permisos:** solo el administrador (`app_users.es_admin`) crea, edita, aprueba y registra. Los demás
  usuarios activos del panel solo ven. La tienda pública solo lee `tiendas_asociadas()`, que no envía
  stock exacto, notas internas, comisiones ni ventas.
- **Fotos:** se optimizan solas antes de subir (logos 400 px en `vendedores/`, productos 1200 px en
  `asociados/`, dentro del bucket `productos-fotos`). El sistema de respaldos ya las incluye.

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
- Registrar automáticamente en la caja el cobro de comisiones (hoy se marcan como cobradas).
- Ficha para compartir con vista previa (`/p/<código>/`) para productos asociados.
