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
"""
import argparse, html, json, os, re, sys, urllib.request, urllib.error

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


def precio_txt(n):
    return "$ " + f"{int(round(n)):,}".replace(",", ".")


def pagina(p, url_ficha, destino, imagen):
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
        imagen = foto or imagen_general
        p = {"codigo": codigo, "nombre": nombre, "precio": precio if precio > 0 else None,
             "disponible": r.get("disponible") is True}
        url_ficha = base + "p/" + codigo + "/" + o.pagina
        destino = base + o.pagina + "?p=" + codigo
        d = os.path.join(carpeta, codigo)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(pagina(p, url_ficha, destino, imagen))
        hechos.add(codigo)

    # Quitar páginas de productos que ya no están publicados (solo las generadas por este script)
    quitados = []
    for nombre in sorted(os.listdir(carpeta)):
        archivo = os.path.join(carpeta, nombre, "index.html")
        if nombre in hechos or not os.path.isfile(archivo):
            continue
        if MARCA in open(archivo, encoding="utf-8").read():
            os.remove(archivo)
            try: os.rmdir(os.path.join(carpeta, nombre))
            except OSError: pass
            quitados.append(nombre)

    texto = [f"## Fichas para compartir", "", f"Base: {base}", "",
             f"- Páginas generadas: **{len(hechos)}** de {len(filas)} productos publicados",
             f"- Quitadas (producto ya no publicado): {len(quitados)}" + (f" ({', '.join(quitados)})" if quitados else ""),
             f"- Sin página propia (se comparten con ?p=): {len(omitidos)}"]
    texto += [f"  - {x}" for x in omitidos]
    print("\n".join(texto))
    if o.resumen:
        with open(o.resumen, "a", encoding="utf-8") as f: f.write("\n".join(texto) + "\n")


if __name__ == "__main__":
    main()
