#!/usr/bin/env python3
"""ELDOSTORE — Páginas para compartir productos (vista previa en WhatsApp y Facebook).

Genera p/<código>/index.html para cada producto publicado, con metadatos Open Graph
propios (foto principal, nombre, código y precio). WhatsApp y Facebook no ejecutan
JavaScript: leen estas etiquetas. Las personas que abren el enlace pasan enseguida a
la ficha de la tienda (?p=<código>).

- Lee SOLO la función pública catalogo_tienda(), con la misma clave publicable que ya
  está en index.html. No escribe nada en Supabase.
- El código se usa tal cual (conserva los ceros iniciales). Se omiten los códigos
  repetidos o con caracteres que no sirven en una dirección (esos productos se
  comparten con ?p=… y muestran la vista previa general).
- Si el catálogo llega vacío o con error, se detiene SIN borrar las páginas existentes.
- Con --copiar-fotos, la foto principal se copia a p/<código>/foto.jpg (máximo
  1200 px y unos 300 KB, para que WhatsApp la muestre), así la vista previa usa
  el mismo dominio de la tienda. Solo se vuelve a descargar si la foto cambió.
"""
import argparse, hashlib, html, io, json, os, re, shutil, sys, urllib.request, urllib.error

CODIGO_RUTA = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$")
MARCA = '<meta name="eldostore-ficha"'


def leer_config(index_html):
    s = open(index_html, encoding="utf-8").read()
    url = re.search(r"supabaseUrl:\s*'([^']+)'", s)
    key = re.search(r"supabaseKey:\s*'([^']+)'", s)
    if not url or not key:
        sys.exit("No encontré supabaseUrl/supabaseKey en index.html")
    return url.group(1).rstrip("/"), key.group(1)


def leer_catalogo(url, key, funcion="catalogo_tienda"):
    pedido = urllib.request.Request(url + "/rest/v1/rpc/" + funcion, data=b"{}", method="POST",
                                    headers={"apikey": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(pedido, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if funcion != "catalogo_tienda":
            return None
        sys.exit(f"catalogo_tienda() respondió {e.code}: {e.read()[:300]!r}")


def descargar(url):
    pedido = urllib.request.Request(url, headers={"User-Agent": "ELDOSTORE-fichas/1.0"})
    with urllib.request.urlopen(pedido, timeout=30) as r:
        return r.read(12 * 1024 * 1024)


def preparar_foto(url, destino):
    """Descarga la foto y la guarda como JPEG liviano. Devuelve (ancho, alto) o None."""
    from PIL import Image  # pillow: se instala en el workflow
    try:
        im = Image.open(io.BytesIO(descargar(url)))
        im.load()
    except Exception as e:  # foto que no carga: se usa la imagen general
        print(f"  aviso: no se pudo usar la foto {url}: {e}")
        return None
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        fondo = Image.new("RGB", im.size, (255, 255, 255))
        fondo.paste(im, mask=im.split()[-1])
        im = fondo
    else:
        im = im.convert("RGB")
    im.thumbnail((1200, 1200))
    for calidad in (85, 78, 70, 62, 55):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=calidad, optimize=True, progressive=True)
        if buf.tell() <= 300 * 1024:
            break
    with open(destino, "wb") as f:
        f.write(buf.getvalue())
    return im.size


def precio_txt(n):
    return "$ " + f"{int(round(n)):,}".replace(",", ".")


def pagina(p, url_ficha, destino, imagen, medidas=None):
    nombre = p["nombre"]
    partes = [f"Código: {p['codigo']}"]
    partes.append(precio_txt(p["precio"]) if p["precio"] else "Consultá el precio")
    partes.append("Disponible" if p["disponible"] else "Sin stock")
    desc = " · ".join(partes) + " · ELDOSTORE, Eldorado (Misiones)"
    a = lambda v: html.escape(str(v), quote=True)
    precio_meta = (f'<meta property="product:price:amount" content="{int(round(p["precio"]))}">\n'
                   f'<meta property="product:price:currency" content="ARS">\n') if p["precio"] else ""
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{a(nombre)} | ELDOSTORE</title>
<meta name="description" content="{a(desc)}">
<link rel="canonical" href="{a(url_ficha)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="ELDOSTORE">
<meta property="og:locale" content="es_AR">
<meta property="og:title" content="{a(nombre)}">
<meta property="og:description" content="{a(desc)}">
<meta property="og:url" content="{a(url_ficha)}">
<meta property="og:image" content="{a(imagen)}">
<meta property="og:image:alt" content="{a(nombre)}">
{(f'<meta property="og:image:width" content="{medidas[0]}">' + chr(10) + f'<meta property="og:image:height" content="{medidas[1]}">' + chr(10)) if medidas else ""}<meta property="og:image:type" content="image/jpeg">
{precio_meta}<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#080808">
<meta name="eldostore-ficha" content="{a(p['codigo'])}">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#080808;color:#fff;font:16px/1.5 Arial,Helvetica,sans-serif;text-align:center}}b{{color:#f4c84f}}a{{color:#f4c84f}}</style>
<script>location.replace({json.dumps(destino)});</script>
</head>
<body>
<p>Abriendo <b>{a(nombre)}</b> en ELDOSTORE…<br><a href="{a(destino)}">Ver el producto</a></p>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="Raíz del sitio, p. ej. https://eldostore.com.ar/")
    ap.add_argument("--pagina", default="", help='"" en el dominio oficial; "index.html" en una prueba')
    ap.add_argument("--salida", default=".", help="Carpeta del repositorio")
    ap.add_argument("--entrada", help="JSON del catálogo (solo para pruebas locales)")
    ap.add_argument("--fotos", help="JSON de fotos_tienda() (solo para pruebas locales)")
    ap.add_argument("--resumen", help="Archivo donde agregar el resumen (GITHUB_STEP_SUMMARY)")
    ap.add_argument("--copiar-fotos", action="store_true", help="Copiar la foto principal a p/<código>/foto.jpg")
    o = ap.parse_args()
    base = o.base.rstrip("/") + "/"

    if o.entrada:
        filas = json.load(open(o.entrada, encoding="utf-8"))
        extras = json.load(open(o.fotos, encoding="utf-8")) if o.fotos else []
    else:
        cfg = leer_config(os.path.join(o.salida, "index.html"))
        filas = leer_catalogo(*cfg)
        extras = leer_catalogo(*cfg, funcion="fotos_tienda") or []  # migración 004 (opcional)
    # Primera foto adicional de cada producto (se usa si no tiene foto principal)
    primera_extra = {}
    for f in extras if isinstance(extras, list) else []:
        pid, url = str(f.get("producto_id")), str(f.get("url") or "")
        if pid not in primera_extra and re.match(r"^https://[^\s\"'<>]+$", url):
            primera_extra[pid] = url
    if not isinstance(filas, list) or not filas:
        sys.exit("El catálogo llegó vacío o con un formato inesperado: no se cambia nada.")

    usos = {}
    for r in filas:
        c = str(r.get("codigo") if r.get("codigo") is not None else "").strip()
        usos[c] = usos.get(c, 0) + 1

    carpeta = os.path.join(o.salida, "p")
    os.makedirs(carpeta, exist_ok=True)
    registro_fotos = os.path.join(carpeta, "fotos.json")  # código -> foto de origen ya copiada
    try: fotos_copiadas = json.load(open(registro_fotos, encoding="utf-8"))
    except (OSError, ValueError): fotos_copiadas = {}
    nuevas_fotos = 0
    hechos, omitidos = set(), []
    imagen_general = base + "img/banner-tecnologia.jpg"
    for r in filas:
        codigo = str(r.get("codigo") if r.get("codigo") is not None else "").strip()
        nombre = re.sub(r"\s+", " ", str(r.get("nombre") or "Producto")).strip()[:140]
        if not CODIGO_RUTA.match(codigo):
            omitidos.append(f"{codigo or '(sin código)'}: caracteres no válidos para una dirección"); continue
        if usos[codigo] > 1:
            omitidos.append(f"{codigo}: código repetido"); continue
        try: precio = float(r.get("precio") or 0)
        except (TypeError, ValueError): precio = 0
        foto = str(r.get("foto") or "").strip()
        if not re.match(r"^https://[^\s\"'<>]+$", foto):
            foto = primera_extra.get(str(r.get("id")), "")
        d = os.path.join(carpeta, codigo)
        os.makedirs(d, exist_ok=True)
        imagen, medidas = foto or imagen_general, None
        if o.copiar_fotos:
            imagen, archivo = imagen_general, os.path.join(d, "foto.jpg")
            previo = fotos_copiadas.get(codigo) or {}
            if foto and previo.get("origen") == foto and os.path.isfile(archivo):
                medidas = tuple(previo.get("medidas") or ()) or None
            elif foto:
                medidas = preparar_foto(foto, archivo)
                if medidas: nuevas_fotos += 1
            if foto and medidas and os.path.isfile(archivo):
                version = hashlib.sha1(open(archivo, "rb").read()).hexdigest()[:10]
                imagen = base + "p/" + codigo + "/foto.jpg?v=" + version
                fotos_copiadas[codigo] = {"origen": foto, "medidas": list(medidas)}
            else:
                fotos_copiadas.pop(codigo, None)
                if os.path.isfile(archivo): os.remove(archivo)
        p = {"codigo": codigo, "nombre": nombre, "precio": precio if precio > 0 else None,
             "disponible": r.get("disponible") is True}
        url_ficha = base + "p/" + codigo + "/" + o.pagina
        destino = base + o.pagina + "?p=" + codigo
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(pagina(p, url_ficha, destino, imagen, medidas))
        hechos.add(codigo)

    # Quitar páginas de productos que ya no están publicados (solo las generadas por este script)
    quitados = []
    for nombre in sorted(os.listdir(carpeta)):
        archivo = os.path.join(carpeta, nombre, "index.html")
        if nombre in hechos or not os.path.isfile(archivo):
            continue
        if MARCA in open(archivo, encoding="utf-8").read():
            shutil.rmtree(os.path.join(carpeta, nombre))
            fotos_copiadas.pop(nombre, None)
            quitados.append(nombre)
    if o.copiar_fotos:
        with open(registro_fotos, "w", encoding="utf-8") as f:
            json.dump(fotos_copiadas, f, ensure_ascii=False, indent=0, sort_keys=True)

    texto = [f"## Fichas para compartir", "", f"Base: {base}", "",
             f"- Páginas generadas: **{len(hechos)}** de {len(filas)} productos publicados",
             f"- Quitadas (producto ya no publicado): {len(quitados)}" + (f" ({', '.join(quitados)})" if quitados else ""),
             f"- Sin página propia (se comparten con ?p=): {len(omitidos)}"]
    if o.copiar_fotos:
        texto.append(f"- Fotos para la vista previa: {len(fotos_copiadas)} en el dominio de la tienda ({nuevas_fotos} nuevas o cambiadas)")
    texto += [f"  - {x}" for x in omitidos]
    print("\n".join(texto))
    if o.resumen:
        with open(o.resumen, "a", encoding="utf-8") as f: f.write("\n".join(texto) + "\n")


if __name__ == "__main__":
    main()
