-- ELDOSTORE — Huella de la base (solo lectura): filas y contenido de cada tabla de public.
-- Se toma antes y después de instalar la 005: las tablas que ya existían tienen que quedar idénticas.
-- Solo muestra cantidades y códigos md5 (nunca datos), porque el registro de GitHub es público.
select table_name as tabla,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text as filas,
  (xpath('/row/c/text()', query_to_xml(format(
     'select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) as c from public.%I t', chr(10), '', table_name), false, true, '')))[1]::text as huella
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by 1;
