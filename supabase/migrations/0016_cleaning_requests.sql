-- Konaklayan odada müşteri temizlik isteyince (karar 19): oda "temizlik istendi" olur, temizlik gönderilince kapanır.
-- HK, süpervizör ve admin kendi bölgesindeki odaya talep girer; süpervizör/admin kaldırabilir.

create table cleaning_requests (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms(id),
  requested_at timestamptz not null default now(),
  requested_by uuid references profiles(id) default auth.uid(),
  note         text
);
create index on cleaning_requests (room_id, requested_at desc);

alter table cleaning_requests enable row level security;
create policy admin_all on cleaning_requests for all using (is_admin()) with check (is_admin());
create policy region_read on cleaning_requests for select using (room_region(room_id) = my_region());
create policy region_insert on cleaning_requests for insert
  with check (room_region(room_id) = my_region() and requested_by = auth.uid());
create policy sup_delete on cleaning_requests for delete using (is_region_sup(room_id));

drop function today_board();
create function today_board() returns table (
  room_id uuid, property_id uuid, room_no text, room_type_code text, day_status day_status, day_status_source text,
  block_id uuid, block_reason text, block_until date,
  cleaning_id uuid, cleaning_status cleaning_status, cleaning_type cleaning_type,
  hk_id uuid, hk_name text, members text[], started_at timestamptz, check_started_at timestamptz,
  finished_at timestamptz,
  hk_state text, hk_state_at timestamptz, occupied boolean, departing boolean, arriving boolean,
  cleaning_requested_at timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid() and active),
       today as (select (now() at time zone 'Europe/Istanbul')::date as d)
  select r.id, r.property_id, r.room_no, rt.code, ds.status, ds.source,
         b.id, b.reason, b.end_date,
         c.id, c.status, c.type, c.hk_id, hp.full_name,
         (select array_agg(p.full_name order by p.full_name) from cleaning_members m join profiles p on p.id = m.profile_id
          where m.cleaning_id = c.id),
         c.started_at, c.check_started_at, c.finished_at,
         hs.hk_state, hs.hk_state_at, hs.occupied, hs.departing, hs.arriving, rq.at
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
  left join lateral room_hk_state(r.id, now()) hs on true
  -- Bugünkü temizlik talebi; talepten sonra gönderilmiş temizlik varsa karşılanmış sayılır
  left join lateral (select max(q.requested_at) as at from cleaning_requests q
                     where q.room_id = r.id and (q.requested_at at time zone 'Europe/Istanbul')::date = today.d
                       and q.requested_at > coalesce((select max(x.finished_at) from cleanings x where x.room_id = r.id
                                                      and x.status in ('submitted', 'analyzing', 'approved')), '-infinity')) rq on true
  where me.role = 'admin' or pr.region = me.region
  order by pr.name, r.room_no
$$;
revoke execute on function today_board() from anon, public;
grant execute on function today_board() to authenticated;
