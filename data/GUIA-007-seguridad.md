# Migración 007 — seguridad de productos y fotos

Rama: `seguridad-007` (desde `main` 87d7b55). **No está aplicada en producción ni integrada en `main`.**
No cambia ningún archivo de la tienda ni del panel: es solo SQL.

## Qué corrige

| Problema | Causa exacta (producción, relevada el 14/11/2026) | Corrección |
|---|---|---|
| Cualquier usuario con sesión lee `products` (costo, stock, stock mínimo) | Política permisiva `acceso_autenticados` (`FOR ALL TO public USING auth.role() = 'authenticated'`). La 003 agregó políticas restrictivas de alta, cambio y baja, pero a propósito no la de lectura. El registro de Supabase Auth está abierto | Política restrictiva `eldo007_lectura_habilitados`: leer `products` exige `eldo_es_usuario_activo()` |
| Cualquier usuario con sesión sube archivos al bucket `productos-fotos` | Políticas `eldostore_fotos_subir`, `_actualizar` y `_borrar` de `storage.objects`: solo piden `bucket_id = 'productos-fotos'` | 3 políticas restrictivas `eldo007_fotos_*_habilitados`: subir, reemplazar y borrar en ese bucket exige `eldo_es_usuario_activo()` |

Aclaración sobre las fotos: hoy reemplazar o borrar fotos existentes también queda frenado, porque
`storage.objects` no tiene ninguna política de lectura (las pruebas lo muestran: 0 fotos afectadas). Pero si
algún día se agrega una, cualquier usuario con sesión podría borrarlas todas. La 007 cierra también ese caso.

## Qué NO cambia

- Diego y Niko: exactamente los mismos permisos (leer, crear, editar y borrar productos; subir fotos).
- Visitantes: la tienda usa `catalogo_tienda()` y `promociones_tienda()` (SECURITY DEFINER), que no pasan por RLS.
  Siguen viendo el catálogo, nunca costos. Las fotos se sirven por URL pública (no pasa por estas políticas).
- Funciones del panel (dueño `postgres` con BYPASSRLS), `service_role` y respaldos: sin cambios.
- Ningún dato, permiso de tabla o función, usuario, configuración ni política existente.
- `vincular_usuario`: revisada, correcta (solo administrador, no puede crear administradores ni tocar su propio acceso).
- `rls_auto_enable`: función de un disparador de eventos de Supabase; llamarla desde la API da error. Sin riesgo; no se toca.

## Archivos

| Archivo | Qué es |
|---|---|
| `data/migracion-007-seguridad-productos-fotos.sql` | La migración (una transacción con controles) |
| `data/migracion-007-verificar.sql` | Verificación posterior, solo lectura |
| `data/migracion-007-revertir.sql` | Quita las 4 políticas (vuelve al estado anterior) |
| `herramientas/prueba-007/base-simulada.sql` | Copia de lo que la 007 toca en producción, para la base descartable |
| `herramientas/prueba-007/probar.sh` | 70 pruebas: antes/después, Diego, Niko, externo, inactivo, visitante, reversión y ROLLBACK |

## Poner en producción (con autorización de Diego)

1. Huella de producción antes (la hace Claude, solo lectura).
2. Supabase → SQL Editor → pegar **todo** `migracion-007-seguridad-productos-fotos.sql` → Run.
   Tiene que terminar en «Migración 007 aplicada…» con la cantidad de productos de la tienda igual a la de antes.
3. Pegar `migracion-007-verificar.sql` → Run: todas las filas en OK.
4. Prueba real en el panel: entrar con tu usuario, ver la lista de productos, editar uno y **subir una foto**.
   Abrir la tienda en una ventana privada y ver el catálogo y las fotos.
5. Recomendado, aparte: Supabase → Authentication → desactivar «Allow new users to sign up». Los usuarios del panel
   se crean desde Authentication → Users → «Add user» y se habilitan en el panel.

Volver atrás: `migracion-007-revertir.sql`.

Orden de reversiones: las políticas de la 007 (igual que las de la 006 y la 003) usan `eldo_es_usuario_activo()`.
Si alguna vez hiciera falta revertir la 003, primero hay que revertir la 007 y la 006. Si no se respeta el orden,
PostgreSQL rechaza la reversión de la 003 completa (no queda nada a medias).

## Repetir las pruebas (base descartable, nunca producción)

```bash
PGURL=postgresql://postgres@127.0.0.1:55998/postgres PGPASSWORD=x herramientas/prueba-007/probar.sh
```
