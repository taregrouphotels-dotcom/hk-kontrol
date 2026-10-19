-- HotelRunner senkronu parça parça: Edge Function bir çağrıda ~100 sn çalışır, kaldığı sayfayı progress'e yazar
-- ve devamı için kendini yeniden çağırır (ilk senkron 6 ayı okur, tek çağrının süre sınırına sığmaz).
alter table pms_sync_runs
  add column heartbeat_at timestamptz,   -- son ilerleme; 3 dk'dan eskiyse çalışma ölmüş sayılır
  add column progress     jsonb;         -- tesis başına {since, next_page, pages, lines, done, error}

-- Devam çağrısı için anahtar (sadece sunucu)
create or replace function get_cron_key() returns text
language sql stable security definer set search_path = public as
$$ select key from ops.cron_key $$;
revoke execute on function get_cron_key() from anon, public, authenticated;
grant execute on function get_cron_key() to service_role;
