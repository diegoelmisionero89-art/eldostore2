"""ELDOSTORE — Convierte el respaldo del PASO 1 (CSV exportado del SQL Editor) en SQL.

Uso:  python3 herramientas/respaldo-csv-a-sql.py respaldo.csv              -> solo controla el archivo
      python3 herramientas/respaldo-csv-a-sql.py respaldo.csv salida.sql   -> además genera el SQL de restauración

Controla, para cada tabla, que la cantidad de filas y el código md5 coincidan con lo
que informó la base al exportar (detecta archivos cortados o modificados).
El SQL generado SOLO se usa en una emergencia: reemplaza el contenido de las tablas
del respaldo por el del archivo, en una sola transacción.
"""
import csv, hashlib, json, sys
csv.field_size_limit(1 << 30)
filas = list(csv.DictReader(open(sys.argv[1], encoding='utf-8-sig', newline='')))
if not filas or not {'tabla', 'filas', 'control', 'datos'} <= set(filas[0]):
    sys.exit('El archivo no tiene las columnas del respaldo (tabla, filas, control, datos).')
ok = True; tablas = []
for f in filas:
    try:
        datos = json.loads(f['datos'] or 'null'); n_ok = isinstance(datos, list) and len(datos) == int(f['filas'])
    except (ValueError, TypeError):
        n_ok = False
    md5_ok = bool(f['datos']) and hashlib.md5(f['datos'].encode('utf-8')).hexdigest() == f['control']
    ok &= n_ok and md5_ok
    print(f"{'OK   ' if n_ok and md5_ok else 'FALLA'} {f['tabla']:<32} {f['filas']:>6} filas" + ('' if md5_ok else '  (el código no coincide)'))
    if f['tabla'] != '_funciones': tablas.append((f['tabla'], f['datos']))
print('\nRespaldo completo y sin cambios.' if ok else '\nEL RESPALDO NO ESTÁ COMPLETO.')
if len(sys.argv) > 2 and ok:
    lit = lambda s: "'" + s.replace("'", "''") + "'"
    with open(sys.argv[2], 'w', encoding='utf-8') as out:
        out.write('-- ELDOSTORE: restauración desde el respaldo (SOLO EMERGENCIA)\nbegin;\nset local session_replication_role = replica;\n')
        for t, _ in tablas: out.write(f'delete from public."{t}";\n')
        for t, d in tablas:
            out.write(f'insert into public."{t}" overriding system value select * from jsonb_populate_recordset(null::public."{t}", {lit(d)}::jsonb);\n')
        # Las numeraciones automáticas (p. ej. audit_log.id) siguen desde el último número restaurado
        out.write("""do $n$ declare c record; begin
  for c in select table_name, column_name from information_schema.columns
           where table_schema = 'public' and is_identity = 'YES' loop
    execute format('select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from public.%I), 0) + 1, false)',
                   'public.' || c.table_name, c.column_name, c.column_name, c.table_name);
  end loop;
end $n$;
""")
        out.write('commit;\n')
    print('SQL de restauración:', sys.argv[2])
sys.exit(0 if ok else 1)
