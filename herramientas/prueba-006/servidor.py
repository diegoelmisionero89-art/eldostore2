#!/usr/bin/env python3
"""Servidor de PRUEBA local para Vendedores asociados V1 (nunca toca producción).

Sirve la tienda y el panel desde la carpeta del repositorio y reemplaza Supabase por
una base PostgreSQL DESCARTABLE: cada llamada rpc() ejecuta la función REAL de la
migración 006 en esa base, con el rol y el usuario que correspondan (visitante = anon,
panel = authenticated + auth.uid() del administrador simulado).

Uso:  PGURL=postgresql://postgres@127.0.0.1:55998/postgres PGPASSWORD=x \
      python3 herramientas/prueba-006/servidor.py 8099
La página carga js/supabase-falso.js en lugar de la librería de Supabase (lo cambia
este servidor al servir index.html y admin.html; los archivos del repositorio no cambian).
"""
import http.server, json, os, re, subprocess, sys, urllib.parse

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PRUEBA = os.path.dirname(os.path.abspath(__file__))
PGURL = os.environ["PGURL"]
ADMIN = "11111111-1111-1111-1111-111111111111"
CDN = re.compile(r'<script src="https://cdn\.jsdelivr\.net/npm/@supabase/supabase-js@2"></script>')


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False)
    return "'" + str(v).replace("'", "''") + "'"


def psql(sql, rol, uid):
    pre = f"set prueba.uid = {lit(uid or '')}; set role {rol};"
    r = subprocess.run(["psql", PGURL, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", pre + sql],
                       capture_output=True, text=True)
    if r.returncode:
        msg = re.sub(r"^(psql:[^\n]*?)?ERROR:\s*", "", r.stderr.strip().splitlines()[0] if r.stderr.strip() else "error")
        return None, {"message": msg}
    out = r.stdout.strip()
    return (json.loads(out) if out else None), None


def es_conjunto(fn):
    d, _ = psql(f"select to_json(coalesce(bool_or(proretset), false)) from pg_proc where proname = {lit(fn)} and pronamespace = 'public'::regnamespace", "postgres", "")
    return bool(d)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=RAIZ, **k)

    def log_message(self, *a):
        pass

    def responder(self, cod, cuerpo, tipo="application/json"):
        b = cuerpo if isinstance(cuerpo, bytes) else json.dumps(cuerpo, ensure_ascii=False).encode()
        self.send_response(cod)
        self.send_header("Content-Type", tipo + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        ruta = urllib.parse.urlparse(self.path).path
        if ruta in ("/", "/index.html", "/admin.html"):
            html = open(os.path.join(RAIZ, "index.html" if ruta in ("/", "/index.html") else "admin.html"), encoding="utf-8").read()
            html = CDN.sub('<script src="/__prueba/supabase-falso.js"></script>', html)
            return self.responder(200, html.encode(), "text/html")
        if ruta == "/__prueba/supabase-falso.js":
            return self.responder(200, open(os.path.join(PRUEBA, "supabase-falso.js"), "rb").read(), "text/javascript")
        if ruta.startswith("/__fotos/"):
            return self.responder(200, open(os.path.join(PRUEBA, "foto.svg"), "rb").read(), "image/svg+xml")
        return super().do_GET()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        q = json.loads(self.rfile.read(n) or b"{}")
        ruta = urllib.parse.urlparse(self.path).path
        panel = q.get("panel")
        rol, uid = ("authenticated", ADMIN) if panel else ("anon", "")
        if ruta == "/__rpc":
            fn = q["fn"]
            if not re.fullmatch(r"[a-z_0-9]+", fn):
                return self.responder(400, {"error": {"message": "nombre"}})
            args = ", ".join(f"{k} => {lit(v)}" for k, v in (q.get("args") or {}).items() if re.fullmatch(r"[a-z_0-9]+", k))
            if es_conjunto(fn):
                sql = f"select coalesce(json_agg(t), '[]') from public.{fn}({args}) t"
            else:
                sql = f"select to_json(public.{fn}({args}))"
            d, e = psql(sql, rol, uid)
            if e and "does not exist" in e["message"]:
                e["message"] = f"Could not find the function public.{fn}"
            return self.responder(200, {"data": d, "error": e})
        if ruta == "/__tabla":
            t = q["tabla"]
            if t == "accounts":   # modo cuentas habilitado (como producción)
                return self.responder(200, {"data": [{"id": "a0000000-0000-0000-0000-000000000001", "codigo": "eldostore", "nombre": "ELDOSTORE", "tipo": "negocio", "activo": True, "creado": "2026-10-01T00:00:00Z"}], "error": None})
            if t == "app_config":
                return self.responder(200, {"data": [{"id": 1, "nombre_negocio": "ELDOSTORE", "next_code": 200}], "error": None})
            if not re.fullmatch(r"[a-z_0-9]+", t):
                return self.responder(400, {"error": {"message": "tabla"}})
            d, e = psql(f"select coalesce(json_agg(t), '[]') from public.{t} t", "postgres", "")
            if e:
                return self.responder(200, {"data": [], "error": None})   # tablas del panel que la base simulada no tiene
            return self.responder(200, {"data": d, "error": None})
        if ruta == "/__subir":
            return self.responder(200, {"url": f"http://127.0.0.1:{self.server.server_port}/__fotos/{q.get('nombre', 'x')}"})
        self.responder(404, {"error": {"message": "no"}})


if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    http.server.ThreadingHTTPServer(("127.0.0.1", puerto), H).serve_forever()
