# Publicar la galería y los enlaces por producto (rama galeria-ficha → main)

Solo con la aprobación de Diego. La etapa 1 no toca Supabase ni el panel.

## Etapa 1 — Tienda: código, compartir y vista previa por producto
1. Copiar a main ÚNICAMENTE estos archivos de galeria-ficha:
   js/tienda.js, css/tienda.css, 404.html, herramientas/generar-fichas.py,
   .github/workflows/fichas-compartir.yml, data/PUBLICAR-galeria-ficha.md
2. NO copiar la carpeta p/ de la rama de prueba (tiene direcciones de prueba).
3. NO copiar en esta etapa el panel (js/ui.js, js/db.js, admin.css) ni la migración 004.
4. Al subir a main, el workflow "Fichas para compartir" corre en main y genera
   p/<código>/ con https://eldostore.com.ar/ en el enlace, la canónica, og:url,
   og:image (foto copiada a p/<código>/foto.jpg) y la redirección. Si alguna página
   tuviera otra dirección, falla y no guarda nada. Después se actualiza cada hora.
5. Mientras corre (1 o 2 minutos), un enlace /p/<código>/ abre igual la ficha (404.html).
6. Verificar: https://eldostore.com.ar/p/009/ abre la ficha; WhatsApp y
   https://developers.facebook.com/tools/debug/ muestran foto, nombre, código y precio.
Sin la migración 004, la galería muestra la foto principal de cada producto.

## Etapa 2 — Varias fotos por producto (más adelante, con autorización expresa)
1. Instalar data/migracion-004-fotos.sql en Supabase (reversión: migracion-004-revertir.sql).
2. Publicar el panel: js/ui.js, js/db.js, admin.css (sección "Fotos adicionales").
