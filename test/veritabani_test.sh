#!/usr/bin/env bash
# Migration'ları boş bir PostgreSQL veritabanına sırayla kurar ve yetki testlerini çalıştırır.
# Kullanım: PGHOST=/tmp PGPORT=5432 PGUSER=postgres test/veritabani_test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=hk_kontrol_test
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f test/supabase_taklit.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f test/rls_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  /  /"

# Excel içe aktarma: boş veritabanında
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f test/supabase_taklit.sql
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f test/import_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  /  /"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f test/pms_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  /  /"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f test/hk_state_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  /  /"
