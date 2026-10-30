# Publicar la galería y los enlaces por producto (rama galeria-ficha → main)

Solo con la aprobación de Diego. Nada de esto toca Supabase.

1. Copiar a main ÚNICAMENTE estos archivos de galeria-ficha:
   js/tienda.js, css/tienda.css, js/ui.js, js/db.js, admin.css, 404.html,
   herramientas/generar-fichas.py, .github/workflows/fichas-compartir.yml,
   data/migracion-004-fotos.sql, data/migracion-004-revertir.sql, data/PUBLICAR-galeria-ficha.md
2. NO copiar la carpeta p/ de la rama de prueba: tiene direcciones de prueba (raw.githack).
3. Al subir a main, el workflow "Fichas para compartir" corre solo en main y genera
   p/<código>/ con https://eldostore.com.ar/ en el enlace, la canónica, og:url y og:image
   (foto copiada a p/<código>/foto.jpg). Si alguna página tuviera otra dirección, falla
   y no guarda nada. Después se actualiza cada hora.
4. Mientras corre (1 o 2 minutos), un enlace /p/<código>/ abre igual la ficha gracias a 404.html.
5. Verificar: https://eldostore.com.ar/p/009/ abre la ficha, y en
   https://developers.facebook.com/tools/debug/ se ven la foto, el nombre y el precio.
6. La migración 004 (varias fotos) es aparte y solo con autorización expresa.
