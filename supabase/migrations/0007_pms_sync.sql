-- HotelRunner senkronu (spec 3, karar 5).
-- pms-sync Edge Function'ı rezervasyonların oda satırlarını pms_reservations'a yazar (sadece oda no, tarih, durum;
-- misafir bilgisi tutulmaz), sonra pms_apply_day_status() bugünün ve yarının oda durumlarını hesaplar.
-- Elle girilen durum (source = 'manual') o gün için ezilmez.

create table pms_reservations (
  line_id       bigint primary key,          -- HotelRunner rooms[].id
  hr_number     text not null,
  pms_name      text not null,               -- properties.pms_name ile eşleşir (Tiny Houses: Tare Suites Urla)
  room_no       text,                        -- atanmamışsa boş
  state         text not null,               -- confirmed, reserved, canceled, no_show ...
  checkin       date not null,
  checkout      date not null,
  hr_updated_at timestamptz,
  synced_at     timestamptz not null default now()
);
create index on pms_reservations (pms_name, room_no);
create index on pms_reservations (checkin, checkout);

create table pms_sync_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  trigger     text not null,                 -- cron | manual
  ok          boolean,
  summary     jsonb
);

alter table pms_reservations enable row level security;
alter table pms_sync_runs enable row level security;
create policy admin_all on pms_reservations for all using (is_admin()) with check (is_admin());
create policy admin_all on pms_sync_runs for all using (is_admin()) with check (is_admin());
-- Süpervizör ve admin son senkron zamanını görür (Bugün ekranı)
create policy manager_read_runs on pms_sync_runs for select using (my_role() in ('supervisor', 'admin'));

-- Gün D için oda durumu (iptal ve no_show hariç):
-- aynı gün çıkış + giriş → checkout_checkin; sadece çıkış → checkout; sadece giriş → checkin;
-- giriş < D < çıkış → stayover; hiçbiri → vacant.
create or replace function pms_room_status(p_pms_name text, p_room_no text, p_day date) returns day_status
language sql stable as $$
  with r as (
    select checkin, checkout from pms_reservations
    where pms_name = p_pms_name and room_no = p_room_no and state not in ('canceled', 'no_show')
      and checkin <= p_day and checkout >= p_day
  )
  select case
    when exists (select 1 from r where checkout = p_day) and exists (select 1 from r where checkin = p_day) then 'checkout_checkin'
    when exists (select 1 from r where checkout = p_day) then 'checkout'
    when exists (select 1 from r where checkin = p_day) then 'checkin'
    when exists (select 1 from r where checkin < p_day and checkout > p_day) then 'stayover'
    else 'vacant'
  end::day_status
$$;

-- Senkronlanan tesislerin odalarına bugünün ve yarının durumunu yazar. Elle girilmiş durum korunur.
-- Dönüş: yazılan satır sayısı ve oda numarası atanmamış (eşleşmeyen) rezervasyonlar.
create or replace function pms_apply_day_status(p_pms_names text[], p_days date[] default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  days date[] := coalesce(p_days, array[(now() at time zone 'Europe/Istanbul')::date,
                                        (now() at time zone 'Europe/Istanbul')::date + 1]);
  written int;
  unmatched jsonb;
begin
  with target as (
    select r.id room_id, p.pms_name, r.room_no, d.day
    from rooms r join properties p on p.id = r.property_id
    cross join unnest(days) as d(day)
    where r.active and p.pms_name = any (p_pms_names)
  ), up as (
    insert into room_day_status (room_id, day, status, source, updated_by, updated_at)
    select room_id, day, pms_room_status(pms_name, room_no, day), 'hotelrunner_api', null, now() from target
    on conflict (room_id, day) do update set status = excluded.status, source = excluded.source,
      updated_by = null, updated_at = now()
      where room_day_status.source <> 'manual'
    returning 1
  )
  select count(*) into written from up;

  -- Bu günlere değen, iptal olmayan ama uygulamadaki bir odaya eşleşmeyen rezervasyonlar (admin uyarısı)
  select coalesce(jsonb_agg(jsonb_build_object('hr_number', x.hr_number, 'pms_name', x.pms_name, 'room_no', x.room_no,
           'checkin', x.checkin, 'checkout', x.checkout) order by x.pms_name, x.checkin), '[]')
    into unmatched
  from pms_reservations x
  where x.pms_name = any (p_pms_names) and x.state not in ('canceled', 'no_show')
    and x.checkin <= (select max(d) from unnest(days) d) and x.checkout >= (select min(d) from unnest(days) d)
    and not exists (select 1 from rooms r join properties p on p.id = r.property_id
                    where p.pms_name = x.pms_name and r.room_no = x.room_no);

  return jsonb_build_object('written', written, 'unmatched', unmatched);
end $$;

revoke execute on function pms_room_status(text, text, date), pms_apply_day_status(text[], date[]) from anon, public, authenticated;
grant execute on function pms_room_status(text, text, date), pms_apply_day_status(text[], date[]) to service_role;

-- ---------- Zamanlama: saatte bir pms-sync ----------
-- Cron isteği kendi anahtarını taşır; anahtar veritabanında üretilir, kimse görmez.
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;
create table ops.cron_key (id int primary key default 1 check (id = 1), key text not null default encode(gen_random_bytes(24), 'hex'));
insert into ops.cron_key default values;

create or replace function check_cron_key(k text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from ops.cron_key where key = k) $$;
revoke execute on function check_cron_key(text) from anon, public, authenticated;
grant execute on function check_cron_key(text) to service_role;

-- pg_cron ve pg_net Supabase'de var; yerel testte yoksa atlanır.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron with schema pg_catalog;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule('pms-sync', '10 * * * *', $job$
      select net.http_post(
        url := 'https://ihwyfllcvkcpjsouhsel.supabase.co/functions/v1/pms-sync',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-cron-key', (select key from ops.cron_key)),
        body := '{"trigger":"cron"}'::jsonb)
    $job$);
  end if;
end $$;

-- ---------- Bugün ekranı: durumun kaynağı da döner (elle girilen "elle" diye görünür) ----------
drop function today_board();
create function today_board() returns table (
  room_id uuid, property_id uuid, room_no text, room_type_code text, day_status day_status, day_status_source text,
  cleaning_id uuid, cleaning_status cleaning_status, cleaning_type cleaning_type,
  hk_id uuid, hk_name text, members text[], started_at timestamptz, check_started_at timestamptz,
  finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid() and active),
       today as (select (now() at time zone 'Europe/Istanbul')::date as d)
  select r.id, r.property_id, r.room_no, rt.code, ds.status, ds.source,
         c.id, c.status, c.type, c.hk_id, hp.full_name,
         (select array_agg(p.full_name order by p.full_name) from cleaning_members m join profiles p on p.id = m.profile_id
          where m.cleaning_id = c.id),
         c.started_at, c.check_started_at, c.finished_at
  from me, today
  join rooms r       on r.active
  join properties pr on pr.id = r.property_id
  join room_types rt on rt.id = r.room_type_id
  left join room_day_status ds on ds.room_id = r.id and ds.day = today.d
  left join lateral (select * from cleanings c where c.room_id = r.id and c.day = today.d and c.status <> 'cancelled'
                     order by c.started_at desc limit 1) c on true
  left join profiles hp on hp.id = c.hk_id
  where me.role = 'admin' or pr.region = me.region
  order by pr.name, r.room_no
$$;
revoke execute on function today_board() from anon, public;
grant execute on function today_board() to authenticated;
