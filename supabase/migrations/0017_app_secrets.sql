-- Uygulama gizli bilgileri (karar 20): admin Veri ekranından girer, kimse okuyamaz; sadece Edge Function'lar
-- (service role) kullanır. Supabase Edge Function secrets'a alternatif: GitHub'dan ve tarayıcıya geri dönmeden girilir.
create table ops.app_secrets (
  name       text primary key check (name in ('ANTHROPIC_API_KEY', 'CLAUDE_MODEL')),
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

-- Admin yazar; değeri geri döndürmez
create or replace function set_app_secret(p_name text, p_value text) returns timestamptz
language plpgsql volatile security definer set search_path = public as $$
declare at timestamptz;
begin
  if not is_admin() then raise exception 'Yetkiniz yok' using errcode = '42501'; end if;
  if nullif(trim(p_value), '') is null then raise exception 'Değer boş' using errcode = '22023'; end if;
  insert into ops.app_secrets (name, value, updated_by) values (p_name, trim(p_value), auth.uid())
  on conflict (name) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
  returning updated_at into at;
  return at;
end $$;
revoke execute on function set_app_secret(text, text) from anon, public;
grant execute on function set_app_secret(text, text) to authenticated;

-- Admin ekranı için: hangi bilgi ne zaman girildi (değer yok)
create or replace function app_secret_status() returns table (name text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.name, s.updated_at from ops.app_secrets s where is_admin()
$$;
revoke execute on function app_secret_status() from anon, public;
grant execute on function app_secret_status() to authenticated;

-- Sadece Edge Function'lar okur
create or replace function get_app_secret(p_name text) returns text
language sql stable security definer set search_path = public as $$
  select value from ops.app_secrets where name = p_name
$$;
revoke execute on function get_app_secret(text) from anon, public, authenticated;
grant execute on function get_app_secret(text) to service_role;
