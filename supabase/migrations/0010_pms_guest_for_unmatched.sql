-- Odası atanmamış rezervasyonlar admin uyarısında misafir adı ve oda tipiyle görünür (rezervasyon no yerine).
-- Misafir adı sadece bu uyarı için tutulur; pms_reservations'ı sadece admin okur.
alter table pms_reservations
  add column guest_name     text,
  add column room_type_name text;   -- HotelRunner'daki oda tipi adı

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

  -- Bu günlere değen, iptal olmayan ama uygulamadaki bir odaya eşleşmeyen rezervasyonlar (admin uyarısı).
  -- Oda tipi: HotelRunner'daki adla başlayan uygulama oda tipinin kodu, yoksa HotelRunner adı.
  select coalesce(jsonb_agg(jsonb_build_object(
           'hr_number', x.hr_number, 'pms_name', x.pms_name, 'room_no', x.room_no,
           'guest_name', x.guest_name,
           'room_type', coalesce(
             (select t.code from room_types t join properties p on p.id = t.property_id
              where p.pms_name = x.pms_name and x.room_type_name ilike t.name || '%'
              order by length(t.name) desc limit 1),
             split_part(x.room_type_name, ',', 1)),
           'checkin', x.checkin, 'checkout', x.checkout) order by x.pms_name, x.checkin), '[]')
    into unmatched
  from pms_reservations x
  where x.pms_name = any (p_pms_names) and x.state not in ('canceled', 'no_show')
    and x.checkin <= (select max(d) from unnest(days) d) and x.checkout >= (select min(d) from unnest(days) d)
    and not exists (select 1 from rooms r join properties p on p.id = r.property_id
                    where p.pms_name = x.pms_name and r.room_no = x.room_no);

  return jsonb_build_object('written', written, 'unmatched', unmatched);
end $$;

revoke execute on function pms_apply_day_status(text[], date[]) from anon, public, authenticated;
grant execute on function pms_apply_day_status(text[], date[]) to service_role;
