"""SOLO PRUEBAS LOCALES. Sirve el repo y traduce las consultas del falso supabase-js a SQL
contra el Postgres local, como el rol 'authenticated' con el usuario indicado."""
import http.server, json, subprocess, sys, os, re
REPO = sys.argv[1]; PORT = int(sys.argv[2]); E2E = os.path.dirname(os.path.abspath(__file__))
IDENT = re.compile(r'^[a-z_][a-z0-9_]*$')
def lit(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (dict, list)): v = json.dumps(v)
    return "'" + str(v).replace("'", "''") + "'"
def ident(x):
    assert IDENT.match(x), x; return '"' + x + '"'
def psql(db, uid, sql):
    claims = json.dumps({'sub': uid, 'role': 'authenticated'}) if uid else ''
    full = f"begin;\nset local role {'authenticated' if uid else 'anon'};\nselect set_config('request.jwt.claims', {lit(claims)}, true) \\g /dev/null\n{sql};\ncommit;\n"
    p = subprocess.run(['psql', '-h', '/home/postgres/pgtest', '-p', '5499', '-U', 'postgres', '-d', db, '-X', '-q', '-tA',
                        '-v', 'ON_ERROR_STOP=1'], input=full, capture_output=True, text=True)
    if p.returncode != 0:
        msg = re.sub(r'^psql:<stdin>:\d+: ERROR:\s*', '', p.stderr.strip().splitlines()[0] if p.stderr.strip() else 'error')
        return None, {'message': msg}
    out = p.stdout.strip()
    return json.loads(out) if out else None, None
def build(b):
    if 'login' in b:
        return f"select to_json(id) from auth.users where email = {lit(b['login'])}"
    if 'rpc' in b:
        fn = ident(b['rpc'])
        args = ', '.join(f"{ident(k)} => {lit(v)}" for k, v in b['args'].items())
        if b.get('_set'): return f"select coalesce(json_agg(t), '[]') from public.{fn}({args}) t"
        return f"select to_json(public.{fn}({args}))"
    t = 'public.' + ident(b['table'])
    where = ' and '.join(f"{ident(c)} = {lit(v)}" for c, v in b['filters']) or 'true'
    if b['op'] == 'select':
        order = ', '.join(f"{ident(c)} {'asc' if a else 'desc'}" for c, a in b['order'])
        lim = f" limit {b['range'][1]-b['range'][0]+1} offset {b['range'][0]}" if b.get('range') else ''
        q = f"select * from {t} where {where}" + (f" order by {order}" if order else '') + lim
        cnt = f"(select count(*) from {t} where {where})" if b.get('count') else 'null'
        return f"select json_build_object('data', coalesce((select json_agg(z) from ({q}) z), '[]'), 'count', {cnt})"
    rows = b['payload'] if isinstance(b.get('payload'), list) else [b.get('payload')]
    if b['op'] in ('insert', 'upsert'):
        cols = list(rows[0].keys()); cl = ', '.join(ident(c) for c in cols)
        conflict = ''
        if b['op'] == 'upsert':
            oc = ident(b.get('onConflict') or 'id')
            conflict = f" on conflict ({oc}) do nothing" if b.get('ignore') else \
                f" on conflict ({oc}) do update set " + ', '.join(f"{ident(c)} = excluded.{ident(c)}" for c in cols)
        q = f"insert into {t} ({cl}) select {cl} from json_populate_recordset(null::{t}, {lit(rows)}){conflict} returning *"
    elif b['op'] == 'update':
        cols = list(rows[0].keys()); cl = ', '.join(ident(c) for c in cols)
        q = f"update {t} set ({cl}) = (select {cl} from json_populate_record(null::{t}, {lit(rows[0])})) where {where} returning *"
    else:
        q = f"delete from {t} where {where} returning *"
    return f"with r as ({q}) select json_build_object('data', coalesce((select json_agg(r) from r), '[]'), 'count', null)"
SETS = {}
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(s, *a, **k): super().__init__(*a, directory=REPO, **k)
    def log_message(s, *a): pass
    def do_GET(s):
        if s.path.startswith('/fake-supabase.js'):
            body = open(os.path.join(E2E, 'fake-supabase.js'), 'rb').read()
            s.send_response(200); s.send_header('Content-Type', 'text/javascript'); s.end_headers(); s.wfile.write(body); return
        return super().do_GET()
    def do_POST(s):
        b = json.loads(s.rfile.read(int(s.headers['Content-Length'])))
        db = s.headers.get('X-Db') or 'eldo_prueba_local'
        if 'rpc' in b:
            if (db, b['rpc']) not in SETS:
                r, _ = psql(db, None, f"select to_json(coalesce(bool_or(proretset), false)) from pg_proc where proname = {lit(b['rpc'])}")
                SETS[(db, b['rpc'])] = bool(r)
            b['_set'] = SETS[(db, b['rpc'])]
        try: data, err = psql(db, b.get('uid'), build(b))
        except Exception as e: data, err = None, {'message': 'bridge: ' + repr(e)}
        if err: res = {'data': None, 'error': err}
        elif 'rpc' in b or 'login' in b:
            res = {'data': data, 'error': None if data is not None or 'rpc' in b else {'message': 'Invalid login credentials'}}
        else:
            rows, count = data['data'], data['count']
            res = {'data': rows, 'count': count, 'error': None}
            if b.get('single'):
                if len(rows) == 1: res['data'] = rows[0]
                elif b['single'] == 'maybe' and not rows: res['data'] = None
                else: res = {'data': None, 'error': {'message': 'JSON object requested, multiple (or no) rows returned', 'code': 'PGRST116'}}
        if err and 'does not exist' in err['message'] and 'relation' in err['message']: err['code'] = '42P01'
        out = json.dumps(res).encode()
        s.send_response(200); s.send_header('Content-Type', 'application/json'); s.end_headers(); s.wfile.write(out)
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
