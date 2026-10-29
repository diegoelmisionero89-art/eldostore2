# ELDOSTORE — Tres cuentas (versión de prueba 003, corrección de seguridad)

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

## Accesos y seguridad (corrección tras la revisión de ChatGPT)

- **Al migrar, solo el administrador queda habilitado.** Es Diego, identificado por el email que se escribe en la línea `ANTES DE CORRER` de la migración. Niko, Ayelen y cualquier otro usuario de Supabase Auth quedan pendientes.
- **Solo el administrador autoriza.** Habilitar, desactivar o cambiar el custodio de otro usuario se hace en `vincular_usuario` (Configuración → Usuarios del panel). Las condiciones:
  - Un usuario que no es administrador recibe un error.
  - Ninguna función puede dar permisos de administrador.
  - El administrador no puede modificar su propio acceso desde el panel.
  - Cada cambio queda en la auditoría.
- **Un usuario con sesión pero sin autorización no puede leer ni modificar datos internos.** Se agregaron políticas *restrictivas* que se suman a las actuales, sin reemplazarlas. La lectura de productos y `catalogo_tienda()` no cambian, así que la tienda pública sigue igual.
- **Funciones SECURITY DEFINER:**
  - Las internas no se pueden ejecutar desde el navegador.
  - Las v3 exigen un usuario habilitado.
  - Las v2 que modifican datos ya no se llaman directamente desde el navegador; el panel nuevo usa las v3, que las llaman por dentro.
  - Los permisos originales quedan guardados en `eldo_003_permisos_originales` y la reversión los restaura.

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
   1. `migracion-003-chequeo-previo.sql`. Todas las filas deben estar en "OK". Las de CHECK y triggers se revisan a mano. La fila 6b lista los emails de Auth: elegí el de Diego. La fila 9 lista las funciones SECURITY DEFINER existentes: si aparece alguna que modifique datos y no figure entre las v2 conocidas, avisá antes de migrar.
   2. Q2 de `CONSULTAS-SOLO-LECTURA-ELDOSTORE.sql` → guardar el resultado.
   3. `migracion-003-cuentas.sql`. Antes de correrla, reemplazá `EMAIL_DEL_ADMINISTRADOR` por el email exacto de Diego. Si falta, no existe o algo no coincide, se detiene sola y no cambia nada.
   3b. Comprobá que solo Diego quedó habilitado: `select nombre, activo, es_admin from app_users;` tiene que devolver una sola fila.
   4. Q2 otra vez → tiene que ser idéntico al paso 2.
   5. `create table public.eldo_base_de_pruebas (creada timestamptz default now());` (marca de base de prueba).
   6. `migracion-003-pruebas.sql` → 72 controles en `t` (incluye T18: accesos y administrador).
   7. `migracion-003-invariantes.sql` → todo 0 (incluye I7 a I9: un solo administrador, v2 cerradas y tablas protegidas).
   8. Opcional: `migracion-003-revertir.sql` (paso A y después B) y volver a migrar.
5. Panel: en una copia de la rama, cambiá `js/supabase-config.js` a la URL y la clave publicable **del proyecto de prueba**. Abrí `admin.html` y probá:
   - venta mixta;
   - gasto repartido;
   - liquidación;
   - anulación;
   - vista Cuentas.

   Probá también los accesos:
   - Niko entra antes de ser autorizado y ve el aviso.
   - Diego lo autoriza.
   - Niko entra, pero no ve el formulario de usuarios.

## Prueba local (ya ejecutada)

Se probó con Postgres 16 y un Supabase simulado.

**Ciclo SQL:**
- Sin email de administrador, o con un email inexistente, la migración se detiene y no aplica nada.
- Con el email correcto, solo queda habilitado el administrador.
- Q2 da igual antes y después.
- Pasan 72 de 72 controles y los 13 invariantes dan 0.
- La reversión elimina las políticas nuevas y devuelve a las v2 permisos de ejecución equivalentes a los originales. Q1 queda igual; la única diferencia es que el permiso "por defecto" aparece escrito de forma explícita, con el mismo efecto.
- Después de revertir, se puede volver a migrar.

**Panel (`pruebas/panel-e2e`): pasan 46 de 46 comprobaciones.**
- Con la base sin migrar, funciona como hoy.
- Niko no entra ni puede autorizarse antes de que Diego lo habilite.
- Diego lo autoriza desde Configuración.
- Niko, ya habilitado, no ve el formulario de accesos, no puede habilitar a Ayelen, no puede hacerse administrador y no puede llamar a las funciones v2.
- Se repitieron las pruebas anteriores: venta mixta, gasto repartido, liquidación, anulaciones y la vista en celular.

## Dependencias no verificadas y qué se hizo

| Falta | Riesgo | Alternativa segura incluida |
|---|---|---|
| Resultados de Q1–Q4 de la base real (no se recibieron) | Tipos, restricciones o funciones distintas a lo supuesto | La migración verifica columnas, tipos, funciones y argumentos y prueba inserciones dentro de una transacción. Ante cualquier diferencia aborta sin cambiar nada. |
| Tipo que devuelven las funciones v2 | Llamarlas mal | Se detecta en tiempo de ejecución (`_eldo3_devuelve_json`). |
| Restricciones CHECK sobre `cash_movements.origen` | Rechazo de los orígenes nuevos | Se prueban dentro de la migración antes de seguir. |
| Cómo revierte caja `void_sale` v2 real | Que la anulación de ventas históricas no quede en ELDOSTORE/Diego | Esas anulaciones se ejecutan con contexto ELDOSTORE/Diego. Además, el invariante I4 lo controla. |
| Triggers en tablas existentes | Efectos no previstos | El chequeo previo los lista para revisarlos. |
| Políticas reales de las tablas existentes | Que alguna tabla no tenga RLS activado | La migración se detiene si encuentra una tabla interna sin RLS. Las políticas actuales no se reemplazan: solo se agregan restricciones. |
| Otras funciones SECURITY DEFINER que no conocemos | Que permitan escribir sin autorización | El chequeo previo (fila 9) las lista para revisarlas antes de migrar. |
| Fotos (Storage, bucket `productos-fotos`) | Un usuario con sesión no autorizado podría subir fotos | No se modificó. Revisar sus políticas en Supabase (pendiente). |
| Bandera `inventario_real_cargado` / ruta de `inventario-real.js` en el panel | Volver a cargar productos borrados | No se tocó (queda como estaba). |

## Lista breve para publicar

1. Correr `migracion-003-chequeo-previo.sql` y Q1–Q4 en la base real (solo lectura) y compartir los resultados. Confirmar el email de Diego en Auth.
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
   7. crear los usuarios de Niko y Ayelen en Auth; Diego los autoriza desde Configuración;
   8. cargar los saldos iniciales si corresponde.
7. Si algo falla después: `migracion-003-revertir.sql` y volver a publicar el panel anterior.
