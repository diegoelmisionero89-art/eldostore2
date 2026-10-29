# Cambios de seguridad · Cuentas V003 (después de la revisión de ChatGPT)

1. **Migración:** ya no habilita a todos los usuarios de `auth.users`.
   - Solo habilita al administrador (Diego), cuyo email se indica en la línea `ANTES DE CORRER`. Si el email falta o no corresponde a un único usuario, la migración se detiene sin cambiar nada.
   - Niko y Ayelen quedan pendientes hasta que Diego los autorice.
2. **`app_users.es_admin`:** columna nueva con un índice que permite un solo administrador, que siempre debe estar activo. La función nueva `eldo_es_admin()` no se puede ejecutar desde el navegador.
3. **`vincular_usuario`:**
   - Solo la puede usar el administrador.
   - No puede crear administradores.
   - El administrador no puede modificar su propio acceso desde el panel, ni nadie puede tocar el acceso del administrador.
   - La auditoría guarda el estado anterior y el nuevo.
4. **Políticas restrictivas (`eldo003_*`)** en las tablas existentes. Un usuario con sesión pero no habilitado no puede leer ni escribir datos internos.
   - Las políticas actuales no se tocan.
   - La lectura de productos y `catalogo_tienda()` no cambian.
   - La migración se detiene si alguna tabla interna no tiene RLS activado.
5. **Funciones v2 que modifican datos** (`register_sale_v2`, `void_sale`, `correct_sale`, `convert_order_to_sale`, `register_purchase`, `void_purchase`, `correct_purchase`, `void_expense`, `correct_expense` y variantes):
   - Ya no se ejecutan directamente desde el navegador.
   - Las v3 las siguen usando por dentro.
   - Sus permisos originales se guardan en `eldo_003_permisos_originales`.
6. **Reversión:** quita las políticas `eldo003_*`, restaura los permisos de las v2 y elimina `eldo_es_admin`.
7. **Chequeo previo:** ahora lista los emails de Auth, el estado de RLS de cada tabla y las funciones SECURITY DEFINER existentes.
8. **Pruebas:**
   - T18 (22 controles nuevos): administrador, autorización, intentos sin permiso, v2 cerradas, tienda pública y auditoría.
   - Invariantes I7 a I9.
   - En el panel en el navegador, 8 comprobaciones nuevas (46 en total).
9. **Panel:** el formulario "Usuarios del panel" solo lo ve el administrador. Se pide confirmación antes de autorizar o desactivar, y el aviso para usuarios sin habilitar indica pedírselo a Diego.

Sin cambios: reglas económicas, funciones de negocio v3, diseño del panel y tienda pública (`index.html`, `css/tienda.css`, `js/tienda.js`).
