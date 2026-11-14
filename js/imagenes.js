/* ==========================================================================
   ELDOSTORE CRM — Optimización de imágenes antes de subirlas (imagenes.js)

   Toda foto que se sube desde el panel (productos, banners y categorías)
   pasa por acá: se achica y se convierte en el propio navegador, y recién
   después se envía a Supabase. Así cada foto pesa ~100 KB en vez de 1-3 MB
   y la tienda gasta mucha menos transferencia.

   - Productos: máximo 1200 px · Banners: 1600 px · Categorías: 400 px.
   - Formato WebP con calidad 82 %. Safari (iPhone, iPad y Mac) no sabe
     generar WebP, así que ahí se usa JPEG con la misma calidad
     (o PNG si es una imagen de categoría con fondo transparente).
   - Si la imagen no se puede leer (por ejemplo HEIC en una PC), no se sube
     nada: se avisa y el formulario queda como estaba.
   - Si no se puede convertir pero el original es JPG/PNG/WebP de hasta 5 MB,
     se avisa y se sube el original sin cambios.
   - Nunca modifica fotos que ya están en Supabase.
   ========================================================================== */

const IMG_TIPOS = {
  producto:  { max: 1200, carpeta: '',           transparencia: false },
  banner:    { max: 1600, carpeta: 'banners',    transparencia: false },
  categoria: { max: 400,  carpeta: 'categorias', transparencia: true },
  // Vendedores asociados (migración 006)
  logo:      { max: 400,  carpeta: 'vendedores', transparencia: true },
  asociado:  { max: 1200, carpeta: 'asociados',  transparencia: false }
};
const IMG_CALIDAD = 0.82;
const IMG_MAX_ENTRADA = 15 * 1024 * 1024;   // lo que se puede elegir
const IMG_MAX_ORIGINAL = 5 * 1024 * 1024;   // lo máximo que se sube sin convertir
const IMG_FORMATOS_WEB = ['image/jpeg', 'image/png', 'image/webp'];

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

function esArchivoImagen(archivo) {
  return !!archivo && (/^image\//.test(archivo.type) || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(archivo.name || ''));
}

/* Lee la imagen respetando la orientación de la cámara del celular. */
async function decodificarImagen(archivo) {
  if (window.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      if (bmp.width && bmp.height) return { fuente: bmp, ancho: bmp.width, alto: bmp.height, cerrar: () => bmp.close && bmp.close() };
    } catch (e) { /* se prueba con <img> */ }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await (img.decode ? img.decode() : new Promise((ok, mal) => { img.onload = ok; img.onerror = mal; }));
    if (!img.naturalWidth) throw new Error('vacía');
    return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, cerrar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    return null;
  }
}

function lienzo(ancho, alto) {
  const c = document.createElement('canvas');
  c.width = ancho; c.height = alto;
  return c;
}

/* Achica en pasos de a la mitad: en Safari queda más nítido que de un salto. */
function dibujarAchicada(img, ancho, alto, fondoBlanco) {
  let fuente = img.fuente, fw = img.ancho, fh = img.alto;
  while (fw / 2 >= ancho * 1.5 && fh / 2 >= alto * 1.5) {
    const paso = lienzo(Math.round(fw / 2), Math.round(fh / 2));
    const px = paso.getContext('2d');
    px.imageSmoothingQuality = 'high';
    px.drawImage(fuente, 0, 0, paso.width, paso.height);
    if (fuente !== img.fuente) { fuente.width = fuente.height = 0; }
    fuente = paso; fw = paso.width; fh = paso.height;
  }
  const c = lienzo(ancho, alto);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (fondoBlanco) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ancho, alto); }
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  if (fuente !== img.fuente) { fuente.width = fuente.height = 0; }
  return c;
}

function tieneTransparencia(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

function aBlob(c, tipo, calidad) {
  return new Promise(ok => {
    try { c.toBlob(b => ok(b), tipo, calidad); } catch (e) { ok(null); }
  });
}

/* Original sin convertir: solo si es un formato que todos los navegadores muestran. */
function originalComoRespaldo(archivo, motivo) {
  if (IMG_FORMATOS_WEB.includes(archivo.type) && archivo.size <= IMG_MAX_ORIGINAL) {
    const ext = archivo.type === 'image/jpeg' ? 'jpg' : archivo.type.split('/')[1];
    return { blob: archivo, mime: archivo.type, ext, formato: 'original', ancho: 0, alto: 0,
      bytesOriginal: archivo.size, bytesFinal: archivo.size, aviso: motivo + ' Se va a subir la imagen original sin cambios.' };
  }
  throw new Error(motivo + ' Elegí otra imagen (JPG o PNG). Tu archivo no se modificó y no se subió nada.');
}

/* Devuelve la imagen lista para subir, o lanza un error con un mensaje claro. */
async function optimizarImagen(archivo, tipo) {
  const cfg = IMG_TIPOS[tipo] || IMG_TIPOS.producto;
  if (!esArchivoImagen(archivo)) throw new Error('Elegí un archivo de imagen.');
  if (archivo.size > IMG_MAX_ENTRADA) throw new Error('La imagen supera los 15 MB. Elegí una más liviana.');

  const img = await decodificarImagen(archivo);
  if (!img) {
    throw new Error('No se pudo leer esa imagen: puede estar dañada o en un formato que este navegador no abre (por ejemplo HEIC). ' +
      'Elegí otra o guardala como JPG. Tu archivo no se modificó y no se subió nada.');
  }
  try {
    const k = Math.min(1, cfg.max / Math.max(img.ancho, img.alto));
    const ancho = Math.max(1, Math.round(img.ancho * k)), alto = Math.max(1, Math.round(img.alto * k));
    let c;
    try { c = dibujarAchicada(img, ancho, alto, false); }
    catch (e) { return originalComoRespaldo(archivo, 'No se pudo optimizar la imagen.'); }

    let blob = await aBlob(c, 'image/webp', IMG_CALIDAD), mime = 'image/webp', ext = 'webp', formato = 'WebP';
    if (!blob || blob.type !== 'image/webp') {
      // Safari: sin WebP. JPEG con fondo blanco, o PNG si es categoría con transparencia.
      if (cfg.transparencia && tieneTransparencia(c)) {
        blob = await aBlob(c, 'image/png'); mime = 'image/png'; ext = 'png'; formato = 'PNG';
      } else {
        const blanco = dibujarAchicada(img, ancho, alto, true);
        blob = await aBlob(blanco, 'image/jpeg', IMG_CALIDAD); mime = 'image/jpeg'; ext = 'jpg'; formato = 'JPEG';
        blanco.width = blanco.height = 0;
      }
    }
    c.width = c.height = 0;
    if (!blob || !blob.size || blob.type !== mime) return originalComoRespaldo(archivo, 'No se pudo optimizar la imagen.');

    // Ya era chica y liviana: convertirla no ahorra nada.
    if (k === 1 && blob.size >= archivo.size && IMG_FORMATOS_WEB.includes(archivo.type) && archivo.size <= IMG_MAX_ORIGINAL) {
      const ext0 = archivo.type === 'image/jpeg' ? 'jpg' : archivo.type.split('/')[1];
      return { blob: archivo, mime: archivo.type, ext: ext0, formato: 'original', ancho, alto,
        bytesOriginal: archivo.size, bytesFinal: archivo.size, aviso: 'La imagen ya estaba optimizada: se sube tal cual.' };
    }
    return { blob, mime, ext, formato, ancho, alto, anchoOriginal: img.ancho, altoOriginal: img.alto,
      bytesOriginal: archivo.size, bytesFinal: blob.size, aviso: '' };
  } finally {
    img.cerrar();
  }
}

/* Sube una imagen ya optimizada y devuelve su dirección pública. */
async function subirImagenOptimizada(resultado, tipo) {
  const cfg = IMG_TIPOS[tipo] || IMG_TIPOS.producto;
  const nombre = `${cfg.carpeta ? cfg.carpeta + '/' : ''}${Date.now()}-${Math.random().toString(36).slice(2)}.${resultado.ext}`;
  const { error } = await sb.storage.from('productos-fotos').upload(nombre, resultado.blob, {
    contentType: resultado.mime, cacheControl: '31536000', upsert: false
  });
  if (error) throw new Error(error.message || 'No se pudo subir la imagen.');
  return sb.storage.from('productos-fotos').getPublicUrl(nombre).data.publicUrl;
}

/* ----------------------------- VISTA PREVIA ----------------------------- */

function htmlVistaPrevia(r, url) {
  if (r.formato === 'original') {
    return `<img src="${url}" alt="Vista previa" class="img-prev-foto">
      <div class="img-prev-info aviso">⚠ ${esc(r.aviso)} (${fmtBytes(r.bytesFinal)})</div>`;
  }
  const ahorro = Math.max(0, Math.round((1 - r.bytesFinal / r.bytesOriginal) * 100));
  return `<img src="${url}" alt="Vista previa" class="img-prev-foto">
    <div class="img-prev-info ok">✓ Lista para subir: ${r.ancho} × ${r.alto} px · ${r.formato} · ${fmtBytes(r.bytesFinal)}
      <small>Original: ${r.anchoOriginal} × ${r.altoOriginal} px · ${fmtBytes(r.bytesOriginal)}${ahorro ? ` · ${ahorro} % más liviana` : ''}</small></div>`;
}

/* Optimiza la imagen elegida y la muestra en `caja`. Devuelve el resultado o null si falló. */
async function mostrarVistaPrevia(archivo, tipo, caja) {
  // Si se elige otra foto antes de que termine esta, solo se muestra la última.
  const turno = (caja._turno || 0) + 1;
  caja._turno = turno;
  if (caja._url) { URL.revokeObjectURL(caja._url); caja._url = null; }
  caja.hidden = false;
  caja.innerHTML = '<div class="img-prev-info">Optimizando imagen…</div>';
  try {
    const r = await optimizarImagen(archivo, tipo);
    if (caja._turno === turno) {
      caja._url = URL.createObjectURL(r.blob);
      caja.innerHTML = htmlVistaPrevia(r, caja._url);
    }
    return r;
  } catch (e) {
    if (caja._turno === turno) caja.innerHTML = `<div class="img-prev-info error">✕ ${esc(e.message)}</div>`;
    throw e;
  }
}

/* Conecta un <input type="file"> con su vista previa. La optimización
   arranca apenas se elige la foto; al guardar se usa imagenElegida(). */
function conectarVistaPrevia(inputId, tipo, cajaId) {
  const input = document.getElementById(inputId), caja = document.getElementById(cajaId);
  if (!input || !caja) return;
  input.addEventListener('change', () => {
    const archivo = input.files[0];
    if (!archivo) { input._img = null; caja.hidden = true; caja.innerHTML = ''; return; }
    input._img = mostrarVistaPrevia(archivo, tipo, caja);
    input._img.catch(() => {});   // el error ya se muestra en la vista previa
  });
}

/* Imagen optimizada del input (espera si todavía se está procesando).
   null si no se eligió foto; lanza el error si no se pudo preparar. */
async function imagenElegida(inputId, tipo) {
  const input = document.getElementById(inputId);
  if (!input || !input.files || !input.files[0]) return null;
  if (!input._img) input._img = optimizarImagen(input.files[0], tipo);
  return await input._img;
}
