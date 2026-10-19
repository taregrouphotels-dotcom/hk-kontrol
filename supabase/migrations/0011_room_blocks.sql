-- Oda kullanım dışı (tadilat, boya, arıza): süpervizör/admin tarih aralığıyla girer, Bugün ekranında koyu görünür.
-- HotelRunner'daki oda kapatmaları API'den gelmediği için uygulamada elle tutulur.
create table room_blocks (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,               -- dahil
  reason      text not null,
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now(),
  constraint dates_ok check (end_date >= start_date)
);
create index on room_blocks (room_id, end_date);

alter table room_blocks enable row level security;
create policy admin_all on room_blocks for all using (is_admin()) with check (is_admin());
create policy region_blocks_read on room_blocks for select using (room_region(room_id) = my_region());
create policy sup_blocks on room_blocks for all using (is_region_sup(room_id)) with check (is_region_sup(room_id));

-- Bugün ekranı: odanın bugünkü kullanım dışı sebebi de döner
drop function today_board();
create function today_board() returns table (
  room_id uuid, property_id uuid, room_no text, room_type_code text, day_status day_status, day_status_source text,
  block_id uuid, block_reason text, block_until date,
  cleaning_id uuid, cleaning_status cleaning_status, cleaning_type cleaning_type,
  hk_id uuid, hk_name text, members text[], started_at timestamptz, check_started_at timestamptz,
  finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid() and active),
       today as (select (now() at time zone 'Europe/Istanbul')::date as d)
  select r.id, r.property_id, r.room_no, rt.code, ds.status, ds.source,
         b.id, b.reason, b.end_date,
         c.id, c.status, c.type, c.hk_id, hp.full_name,
         (select array_agg(p.full_name order by p.full_name) from cleaning_members m join profiles p on p.id = m.profile_id
          where m.cleaning_id = c.id),
         c.started_at, c.check_started_at, c.finished_at
  from me, today
  join rooms r       on r.active
  join properties pr on pr.id = r.property_id
  join room_types rt on rt.id = r.room_type_id
  left join room_day_status ds on ds.room_id = r.id and ds.day = today.d
  left join lateral (select * from room_blocks b where b.room_id = r.id and today.d between b.start_date and b.end_date
                     order by b.created_at desc limit 1) b on true
  left join lateral (select * from cleanings c where c.room_id = r.id and c.day = today.d and c.status <> 'cancelled'
                     order by c.started_at desc limit 1) c on true
  left join profiles hp on hp.id = c.hk_id
  where me.role = 'admin' or pr.region = me.region
  order by pr.name, r.room_no
$$;
revoke execute on function today_board() from anon, public;
grant execute on function today_board() to authenticated;
