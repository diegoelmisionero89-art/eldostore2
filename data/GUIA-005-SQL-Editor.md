# ELDOSTORE · Instalar la 005 desde Supabase SQL Editor (paso a paso)

Sin contraseña de la base, sin secretos en GitHub y sin cambiar conexiones: todo se hace
desde el panel de Supabase, donde ya estás conectado como dueño del proyecto.

Tiempo: unos 15 minutos. **Durante los pasos 2 a 4 no cargues ventas ni edites nada en el panel**
(si no, el código del paso 4 no coincide con el del paso 2 y hay que revisar).

## Archivos (rama `promociones-revision`)

| Paso | Archivo | ¿Cambia la base? |
|---|---|---|
| 1 | `data/editor-005-paso1-respaldo.sql` | No, solo lee |
| 2 y 4 | `data/editor-005-paso2-huella.sql` | No, solo lee |
| 3 | `data/migracion-005-promociones.sql` (versión aprobada) | Sí: agrega 6 tablas y 17 funciones |
| 5 | `data/editor-005-paso5-verificacion.sql` | No, solo lee |
| Emergencia | `data/migracion-005-revertir.sql` | Quita lo que agregó la 005 |

Cómo copiar un archivo desde el iPhone: abrí el enlace de GitHub del archivo → botón
**Copy raw file** (ícono de dos hojas, arriba a la derecha del código). Pegalo entero en el editor.

## Antes de empezar: el proyecto correcto

1. Entrá a supabase.com → tu organización → proyecto de ELDOSTORE → **SQL Editor** → **New query**.
2. Mirá la dirección del navegador: tiene que contener **`/project/vahzvjhrtnfcjfrmwbol/`**.
   Es el mismo proyecto que usan la tienda y el panel. Si dice otra cosa, no sigas.
3. Además, los pasos 1, 2 y 5 controlan solos que la base sea la de ELDOSTORE (el administrador
   tiene que ser tu cuenta). Si no lo es, se detienen con el aviso
   *"ESTE NO ES EL PROYECTO DE PRODUCCIÓN DE ELDOSTORE. No se hizo nada."*

## Paso 0 · Respaldo desde el panel (1 toque)
Panel de ELDOSTORE → **Configuración** → **Descargar respaldo (JSON)** → guardalo en Archivos.

## Paso 1 · Respaldo completo de la base
1. Pegá `editor-005-paso1-respaldo.sql` → **Run**.
2. Aparece una fila por tabla (products, sales, cash_movements, etc.) y una fila `_funciones`.
3. Arriba de los resultados: **Export → Download CSV**. Guardá el archivo en Archivos/iCloud.
4. Mandámelo por acá: controlo que cada tabla esté completa (filas y código de control).
   Hasta que te confirme que está completo, no sigas con el paso 3.

## Paso 2 · Huella ANTES
1. Nueva consulta → pegá `editor-005-paso2-huella.sql` → **Run**.
2. Resultado (una fila): `migracion_005 = NO instalada` y `listo_para_instalar = sí`.
3. Sacá captura (sobre todo de **codigo**). Si `listo_para_instalar` dice "NO: …", pará y mandame la captura.

## Paso 3 · Instalar la 005
1. Nueva consulta → pegá **todo** `migracion-005-promociones.sql`.
2. Controlá que la última línea del editor sea `-- FIN DEL ARCHIVO 005` (si no, se cortó al copiar).
3. **Run**. Supabase puede avisar *"destructive operation"*: es porque dentro de las funciones nuevas
   aparecen palabras como `delete` (por ejemplo, para eliminar un banner) y `alter table` (para activar la
   seguridad de las tablas nuevas). Confirmá la ejecución en ese aviso.
4. Resultado esperado: **"Migración 005 instalada correctamente"**, con la cantidad de categorías y de productos de la tienda.
   - Si aparece un error, **no se instaló nada** (corre en una sola transacción). Mandame la captura y no repitas.

## Paso 4 · Huella DESPUÉS
1. Corré otra vez `editor-005-paso2-huella.sql`.
2. Ahora `migracion_005 = INSTALADA`, y **codigo, tablas, filas, productos y ventas tienen que ser
   idénticos** a los del paso 2. Mandame las dos capturas.

## Paso 5 · Verificación (solo lectura)
1. Nueva consulta → pegá `editor-005-paso5-verificacion.sql` → **Run**.
   (Puede aparecer el aviso de "destructive operation" porque controla los permisos llamados
   *delete*, *update* y *truncate*; la consulta solo lee. Confirmá.)
2. Son 28 controles: 15 de la 005 y 13 reglas de consistencia de caja y cuentas de la V003.
   **Todos tienen que decir OK.** Mandame la captura.

## Paso 6 · Publicación (lo hago yo, con tu OK)
Publico la rama en main y controlo que eldostore.com.ar tenga los archivos nuevos.

## Paso 7 · Control en el iPhone (sin ventas reales)
- Tienda: se ve igual que hoy (sin banners todavía), las categorías y los precios de siempre.
- Panel → **Tienda online**: abre con 5 pestañas y la lista de categorías.
- Poné un descuento de prueba en un producto → la tienda lo muestra → **quitalo**.
- Ventas → **+ Registrar venta**: agregá ese producto mientras tiene el descuento y mirá que el precio
  aparezca con el %; después **Cancelar** (no guardar).

## Si algo sale mal
- **Error en el paso 3:** no quedó nada instalado. Mandame la captura.
- **Volver atrás después de instalar:** `migracion-005-revertir.sql`. Primero corré solo la parte
  "PASO A" (informe) y mandámelo. La tienda y el panel vuelven solos a funcionar como antes.
- **Recuperar datos:** con el CSV del paso 1, `herramientas/respaldo-csv-a-sql.py` controla el archivo y
  arma el SQL de restauración (solo en una emergencia y con tu autorización).
