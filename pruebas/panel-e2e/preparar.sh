#!/bin/bash
# Crea dos bases locales: eldo_legacy (sin migrar) y eldo_prueba_local (migrada). SOLO LOCAL.
set -e
R="$(cd "$(dirname "$0")/../.." && pwd)"
pgl -d postgres -c "drop database if exists eldo_legacy" -c "drop database if exists eldo_prueba_local" -c "create database eldo_prueba_local" >/dev/null
for f in 00-esquema-simulado.sql 01-funciones-v2-simuladas.sql 02-datos-historicos.sql; do pgl -d eldo_prueba_local -f $R/pruebas/entorno-local/$f >/dev/null; done
# Niko y Ayelen ya existen en Auth ANTES de migrar: no deben quedar habilitados.
pgl -d eldo_prueba_local -c "insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222','niko@prueba.local'),('33333333-3333-3333-3333-333333333333','ayelen@prueba.local')" >/dev/null
pgl -d postgres -c "create database eldo_legacy template eldo_prueba_local" >/dev/null
sed "s/'EMAIL_DEL_ADMINISTRADOR', true)/'diego@prueba.local', true)/" $R/data/migracion-003-cuentas.sql | pgl -d eldo_prueba_local >/dev/null
echo "bases listas"; pgl -d eldo_prueba_local -tA -c "select count(*) from products" -c "select count(*) from sales" -c "select count(*) from app_users"
