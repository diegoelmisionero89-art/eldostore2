# ELDOSTORE — Migración 005 (promociones): procedimiento para revisión

Estado (4/11/2026): migración 005 INSTALADA en el proyecto Supabase de la tienda
(vahzvjhrtnfcjfrmwbol), con respaldo previo verificado (esquema respaldo_005_20261104),
huella de datos idéntica antes y después, y 28 de 28 controles OK. Las pruebas en un
proyecto separado no se hicieron: Diego decidió instalar directamente.

Archivos:
- `data/migracion-005-promociones.sql`: la migración (solo agrega).
- `data/migracion-005-revertir.sql`: la reversión.
- `data/editor-005-*.sql` y `data/GUIA-005-SQL-Editor.md`: respaldo, huella y verificación de solo lectura.

Decisiones de Diego aplicadas:
- Solo el administrador modifica promociones.
- El precio con descuento es el exacto del %, al peso.
- Renombrar una categoría actualiza la categoría de sus productos (solo esa columna).
- No se elimina una categoría que tenga productos.
- Al vencer la oferta flash, el producto vuelve solo a su precio anterior.
- Las pruebas se hacen en un proyecto Supabase separado.

## 1. Respaldo y prueba de recuperación
1. **Respaldo integral:** workflow "Respaldo Supabase" (ya existe en main).
   - Hace el volcado completo con `supabase db dump`, más los usuarios de Auth.
   - Compara las filas de products, sales y auth.users con la base en vivo.
   - El archivo queda cifrado.
   - Si falta algo, falla y no guarda nada.
2. **Recuperación comprobada:** el proyecto de PRUEBAS se arma RESTAURANDO ese respaldo
   con el workflow "Restaurar respaldo en pruebas".
   - Se niega si el destino es producción o si la base de pruebas no está vacía.
   - Después de restaurar, compara las filas con las del momento del respaldo.
   - Corre las reglas de consistencia de la V003, que tienen que dar 0.
   - Si todo coincide, el respaldo queda probado: se puede recuperar.
3. **Antes de instalar la 005 en producción** (cuando Diego lo autorice): un respaldo
   nuevo del mismo día.
4. **No incluido en el respaldo:** los archivos de Storage (fotos). La 005 no los toca.

## 2. Precio con descuento en las ventas del panel
- **Regla única, en la base** (`eldo_descuento_en`):
  - Si el producto está en una oferta flash vigente, vale el % de la flash.
  - Si no, vale su descuento manual vigente.
  - Si no tiene ninguno, vale el precio habitual.
- **Cálculo:** precio habitual × (100 − %) / 100, redondeado al peso.
  - 33.475 con 20 % = 26.780.
  - 1.999 con 35 % = 1.299.
- **Panel:** al cargar un producto en una venta, la línea muestra el precio con
  descuento vigente ("20 % OFF · habitual $ 33.475"), con la opción de usar el habitual.
  - Si el pedido se hizo durante una oferta ya vencida, se indica la fecha del pedido
    (hasta 7 días atrás).
- **Registro:** `registrar_venta_promocion()`.
  - La base CALCULA el precio y no acepta el que manda el navegador.
  - Rechaza un % que no estaba vigente en la fecha del pedido.
  - Registra la venta con la función de ventas de la V003 (stock, cuentas, caja, igual que hoy).
  - Guarda el detalle en `ventas_descuentos`: precio habitual, %, precio aplicado,
    origen (manual o flash) y fecha del pedido.
  - Las ventas sin descuento siguen exactamente como hoy.
- **Corregir una venta con descuento:** la corrección (función de la V003) conserva los
  precios con los que se vendió cada línea. El detalle de `ventas_descuentos` queda asociado
  a la venta original (que la corrección anula), así que para consultarlo se mira la venta original.

## 3. Ofertas vencidas
- **En la base:**
  - `promociones_tienda()` solo envía lo vigente en ese momento, con la hora del servidor.
  - Los descuentos y ofertas no se borran: se cierran con fecha, y lo vencido nunca vuelve a enviarse.
- **En la tienda** (etapa de implementación):
  - El temporizador usa la hora del servidor, no la del teléfono.
  - Al llegar a cero, los precios, la ficha y el carrito vuelven al precio anterior.
  - Las promociones se vuelven a consultar al volver a la página y cada 5 minutos.
  - Antes de abrir WhatsApp se controla el vencimiento. Si venció, se actualizan los
    precios y se avisa, y el pedido sale con el precio correcto.
  - El carrito guarda solo productos y cantidades; los precios se calculan siempre al cargar.
- **En el mensaje:** "20 % OFF · precio habitual $ X · válido hasta dd/mm hh:mm".
- **En el panel:** la base valida el descuento en la fecha del pedido, así que no se
  puede cobrar una oferta vencida por error.
- **Vista previa al compartir:** en esta etapa sigue mostrando el precio habitual, porque
  se actualiza cada hora y podría mostrar una oferta vencida.

## 4. Pruebas sin afectar la tienda publicada
1. **Proyecto Supabase de pruebas** (Diego, desde el panel de Supabase): proyecto gratuito
   nuevo, con la misma versión de Postgres que producción.
2. **Secretos en GitHub:** `SUPABASE_TEST_DB_URL`, y se reutilizan `RESPALDO_CLAVE` y `SUPABASE_DB_URL`.
3. **Restaurar** el último respaldo con el workflow; queda probada la recuperación.
4. **Instalar la 005 en el proyecto de PRUEBAS** y correr `migracion-005-pruebas.sql`
   (tiene que dar todo OK).
5. **Rama de prueba** con el código del panel y de la tienda, apuntando al proyecto de
   PRUEBAS (solo en esa rama).
   - Antes de publicar se comprueba que en main la configuración siga apuntando a producción.
6. **Revisión desde el iPhone** con la versión de prueba (raw.githack).
   - La tienda publicada y la base real no cambian.
   - Ojo: los WhatsApp de la versión de prueba son los números reales.
7. **Recién con la aprobación:** respaldo del día, instalar la 005 en producción, control
   posterior y publicar por etapas.

Nota: para poder ejecutar "Restaurar respaldo en pruebas" desde el botón Run workflow,
GitHub exige que el archivo esté en main. Agregarlo no cambia la tienda (es un archivo
de GitHub Actions), pero requiere la autorización de Diego.
