#!/usr/bin/env bash
# supabase/migrations klasöründeki henüz uygulanmamış migration'ları Supabase'e uygular.
# Supabase Management API'yi kullanır; SUPABASE_ACCESS_TOKEN ve SUPABASE_PROJECT_REF gerekir.
# Uygulananlar ops.migration_log tablosunda tutulur. Her migration kaydıyla birlikte tek işlemde çalışır.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN tanımlı değil}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF tanımlı değil}"
API="${SUPABASE_API:-https://api.supabase.com}/v1/projects/$SUPABASE_PROJECT_REF/database/query"

# SQL çalıştırır, sonucu JSON olarak yazar; hata olursa mesajı gösterip durur.
query() {
  local body resp code
  body=$(jq -Rs '{query: .}' <<<"$1")
  resp=$(curl -sS -w '\n%{http_code}' -X POST "$API" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$body")
  code=${resp##*$'\n'}
  resp=${resp%$'\n'*}
  if [[ "$code" -ge 300 ]]; then
    echo "::error::Supabase hatası ($code): $resp" >&2
    return 1
  fi
  printf '%s' "$resp"
}

query "create schema if not exists ops;
       revoke all on schema ops from public, anon, authenticated;
       create table if not exists ops.migration_log (
         version    text primary key,
         applied_at timestamptz not null default now());" > /dev/null

for file in supabase/migrations/*.sql; do
  version=$(basename "$file" | cut -d_ -f1)
  if [[ "$(query "select count(*) as n from ops.migration_log where version = '$version'" | jq -r '.[0].n')" != "0" ]]; then
    echo "zaten uygulanmış: $file"
    continue
  fi
  echo "uygulanıyor: $file"
  query "begin;
$(cat "$file")
insert into ops.migration_log (version) values ('$version');
commit;" > /dev/null
  echo "tamam: $file"
done
echo "Veritabanı güncel."
