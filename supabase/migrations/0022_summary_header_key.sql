-- Günlük özet anahtarı istek başlığından da okunur (x-summary-key): n8n'de kimlik bilgisi (Header Auth) olarak durur,
-- akışın içine yazılmaz.
create or replace function daily_summary_auth(p_kind text default 'morning') returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return daily_summary(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-summary-key', p_kind);
end $$;
revoke execute on function daily_summary_auth(text) from public;
grant execute on function daily_summary_auth(text) to anon, authenticated;
