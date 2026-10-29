# ELDOSTORE — Tres cuentas (versión de prueba 003)

Rama: `cuentas-v003`. **No está en producción.** La tienda pública (`index.html`, `css/tienda.css`, `js/tienda.js`) no se tocó: sigue leyendo `catalogo_tienda()`.

## Qué cambia

| Archivo | Cambio |
|---|---|
| `data/migracion-003-cuentas.sql` | Migración. Tablas nuevas, columnas nuevas, funciones nuevas `*_v3`. **Las funciones actuales (v2) no se modifican**: las v3 las usan por dentro. |
| `data/migracion-003-chequeo-previo.sql` | Solo lectura. Verifica los supuestos antes de migrar. |
| `data/migracion-003-pruebas.sql` | 16 pruebas (50 controles). Solo corre en una base marcada como de prueba. |
| `data/migracion-003-invariantes.sql` | Solo lectura. 10 reglas que tienen que dar 0. |
| `data/migracion-003-revertir.sql` | Quita todo lo agregado. Ventas, compras, gastos y caja se conservan. |
| `js/db.js` | Lectura paginada (corrige el límite de 1000 filas). Si detecta la migración usa las funciones v3; si no, hace exactamente lo de antes. |
| `js/ui.js`, `admin.html`, `admin.css` | Pantallas con cuenta y "quién cobró / pagó", reparto de gastos, vista **Cuentas**, movimientos entre cuentas, usuarios del panel. Todo oculto si la base no está migrada. |
| `pruebas/entorno-local/` | Esquema y funciones v2 **simuladas** para probar en Postgres local. No son el SQL real. |
| `pruebas/panel-e2e/` | Prueba automática del panel en el navegador contra Postgres local. |

## Cómo funciona (resumen)

- Cada movimiento de caja tiene **cuenta** (de quién es el dinero) y **custodio** (quién lo tiene).
- Venta mixta: cada línea va a la cuenta del dueño del producto; quien cobra queda como custodio.
- Gasto compartido: partes manuales que tienen que sumar el total.
- Liquidación: cambia el custodio sin cambiar la cuenta. Reparto: pasa dinero entre cuentas.
- Todo lo anterior a la migración queda en ELDOSTORE / Diego.
- Anular o corregir deja historial y quién lo hizo (`creado_por`, `anulado_por`, `audit_log`).

## Probar en una base separada (nunca en la real)

1. Crear un proyecto nuevo de Supabase **solo para pruebas**.
2. Recrear ahí la estructura actual: tablas, políticas y funciones v2, copiadas de la base real (Database → Schema / SQL de las funciones). Requiere el resultado de Q1 (ver "Dependencias").
3. Opcional: copiar datos (export CSV de la real → import en la de prueba).
4. En el SQL Editor del proyecto **de prueba**, en este orden:
   1. `migracion-003-chequeo-previo.sql` → todas las filas en "OK" (las de CHECK/triggers se revisan a mano).
   2. Q2 de `CONSULTAS-SOLO-LECTURA-ELDOSTORE.sql` → guardar el resultado.
   3. `migracion-003-cuentas.sql` → si algo no coincide, se detiene sola y no cambia nada.
   4. Q2 otra vez → tiene que ser idéntico al paso 2.
   5. `create table public.eldo_base_de_pruebas (creada timestamptz default now());` (marca de base de prueba).
   6. `migracion-003-pruebas.sql` → 50 controles en `t`.
   7. `migracion-003-invariantes.sql` → todo 0.
   8. Opcional: `migracion-003-revertir.sql` (paso A y después B) y volver a migrar.
5. Panel: en una copia de la rama, cambiar `js/supabase-config.js` a la URL y clave publicable **del proyecto de prueba**, abrir `admin.html` y probar: venta mixta, gasto repartido, liquidación, anulación, vista Cuentas, usuarios.

## Prueba local (ya ejecutada)

Con Postgres 16 y Supabase simulado:

- Ciclo SQL: chequeo OK, Q2 igual antes y después, 50/50 pruebas, invariantes en 0. La reversión deja Q1 igual y la migración vuelve a aplicarse. En la prueba de concurrencia, de dos ventas simultáneas del último stock solo una pasa.
- Panel (`pruebas/panel-e2e`): 38/38. Con la base sin migrar, el panel funciona como hoy. Con la base migrada, se probaron:
  - productos de Niko;
  - venta mixta cobrada por Ayelen;
  - gasto 1000/2000;
  - liquidación y su anulación;
  - anulación de venta con devolución de stock;
  - vinculación de usuario;
  - bloqueo de un usuario no vinculado;
  - vista en celular sin desborde.

## Dependencias no verificadas y qué se hizo

| Falta | Riesgo | Alternativa segura incluida |
|---|---|---|
| Resultados de Q1–Q4 de la base real (no se recibieron) | Tipos, restricciones o funciones distintas a lo supuesto | La migración verifica columnas, tipos, funciones y argumentos y prueba inserciones dentro de una transacción. Ante cualquier diferencia aborta sin cambiar nada. |
| Tipo que devuelven las funciones v2 | Llamarlas mal | Se detecta en tiempo de ejecución (`_eldo3_devuelve_json`). |
| Restricciones CHECK sobre `cash_movements.origen` | Rechazo de los orígenes nuevos | Se prueban dentro de la migración antes de seguir. |
| Cómo revierte caja `void_sale` v2 real | Que la anulación de ventas históricas no quede en ELDOSTORE/Diego | Esas anulaciones se ejecutan con contexto ELDOSTORE/Diego. Además, el invariante I4 lo controla. |
| Triggers en tablas existentes | Efectos no previstos | El chequeo previo los lista para revisarlos. |
| Bandera `inventario_real_cargado` / ruta de `inventario-real.js` en el panel | Volver a cargar productos borrados | No se tocó (queda como estaba). |

## Lista breve para publicar

1. Correr `migracion-003-chequeo-previo.sql` y Q1–Q4 en la base real (solo lectura) y compartir los resultados.
2. Confirmar las decisiones D1–D10 (sobre todo D3 envío, D4 seña y D7 saldos iniciales).
3. Probar en un proyecto Supabase separado, siguiendo los pasos de arriba.
4. Revisión de ChatGPT y autorización de Diego.
5. Verificar en Supabase: registro público de usuarios (signup) desactivado y "Max rows" del API.
6. Producción, en una ventana sin ventas:
   1. respaldo completo;
   2. Q2;
   3. migración;
   4. Q2 igual;
   5. invariantes;
   6. publicar el panel (fusionar la rama);
   7. crear los usuarios de Niko y Ayelen en Auth y vincularlos desde Configuración;
   8. cargar los saldos iniciales si corresponde.
7. Si algo falla después: `migracion-003-revertir.sql` y volver a publicar el panel anterior.
