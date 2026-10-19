-- Oda temiz mi, şu an dolu mu (karar 17). Günlük durum (çıkış/giriş/konaklama/boş) tek başına yetmez:
--   * Çıkış saati (varsayılan 12:00) gelince misafir çıkmış sayılır, oda "kirli" olur; temizlik gönderilince "temiz".
--     Çıkış günü 12:00'den önce temizliğe başlandıysa misafir erken çıkmış demektir; o an kirli sayılır.
--   * Giriş saati (varsayılan 14:00) gelince giriş olan oda "dolu" sayılır.
--   * Süpervizör odayı elle "temiz" ya da "kirli" işaretleyebilir (ör. sistem öncesi durum, misafir odayı kullandı).
-- Hesap her sorguda o anki saate göre yapılır; 12:00 ve 14:00'te ve her temizlikte kendiliğinden güncellenir.

insert into settings (key, value) values ('checkout_time', '"12:00"'), ('checkin_time', '"14:00"')
on conflict (key) do nothing;

create table room_hk_marks (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id),
  clean      boolean not null,
  at         timestamptz not null default now(),
  created_by uuid references profiles(id) default auth.uid(),
  note       text
);
create index on room_hk_marks (room_id, at desc);

alter table room_hk_marks enable row level security;
create policy admin_all on room_hk_marks for all using (is_admin()) with check (is_admin());
create policy sup_marks on room_hk_marks for all using (is_region_sup(room_id))
  with check (is_region_sup(room_id) and created_by = auth.uid());
create policy region_marks_read on room_hk_marks for select using (room_region(room_id) = my_region());

-- Bir odanın p_now anındaki durumu.
--   hk_state: clean | dirty | unknown (hiç çıkış/temizlik/işaret kaydı yoksa)
--   occupied: şu an misafir var mı (günlük durum yoksa null); departing: bugün çıkacak, henüz çıkış saati gelmedi;
--   arriving: bugün giriş var, henüz giriş saati gelmedi
create or replace function room_hk_state(p_room uuid, p_now timestamptz default now())
returns table (hk_state text, hk_state_at timestamptz, occupied boolean, departing boolean, arriving boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select value #>> '{}' from settings where key = 'checkout_time'), '12:00')::time as co,
           coalesce((select value #>> '{}' from settings where key = 'checkin_time'), '14:00')::time as ci,
           (p_now at time zone 'Europe/Istanbul')::date as today,
           (p_now at time zone 'Europe/Istanbul')::time as t
  ),
  room as (
    select r.room_no, p.pms_name from rooms r join properties p on p.id = r.property_id where r.id = p_room
  ),
  -- Çıkış günleri: günlük durum kaydı olan günlerde o kayıt (elle girilen dahil), olmayan eski günlerde rezervasyonlar
  out_days as (
    select ds.day from room_day_status ds
    where ds.room_id = p_room and ds.status in ('checkout', 'checkout_checkin')
    union
    select x.checkout from pms_reservations x join room on x.pms_name = room.pms_name and x.room_no = room.room_no
    where x.state not in ('canceled', 'no_show')
      and not exists (select 1 from room_day_status ds where ds.room_id = p_room and ds.day = x.checkout)
  ),
  events as (
    select least(((o.day + cfg.co) at time zone 'Europe/Istanbul'),
                 (select min(c.started_at) - interval '1 second' from cleanings c
                  where c.room_id = p_room and c.day = o.day and c.status <> 'cancelled' and c.type = 'full')) as at,
           false as clean
    from out_days o, cfg
    union all
    select c.finished_at, true from cleanings c
    where c.room_id = p_room and c.status in ('submitted', 'analyzing', 'approved') and c.finished_at is not null
    union all
    select m.at, m.clean from room_hk_marks m where m.room_id = p_room
  ),
  last as (select * from events where at <= p_now order by at desc, clean limit 1),
  st as (select ds.status from room_day_status ds, cfg where ds.room_id = p_room and ds.day = cfg.today)
  select case when last.at is null then 'unknown' when last.clean then 'clean' else 'dirty' end,
         last.at,
         case st.status
           when 'stayover' then true
           when 'checkout' then cfg.t < cfg.co
           when 'checkout_checkin' then cfg.t < cfg.co or cfg.t >= cfg.ci
           when 'checkin' then cfg.t >= cfg.ci
           when 'vacant' then false
         end,
         coalesce(st.status in ('checkout', 'checkout_checkin') and cfg.t < cfg.co, false),
         coalesce(st.status in ('checkin', 'checkout_checkin') and cfg.t < cfg.ci, false)
  from cfg left join st on true left join last on true
$$;
revoke execute on function room_hk_state(uuid, timestamptz) from anon, public, authenticated;

-- Bugün ekranı: oda temiz/kirli ve şu anki doluluk da döner
drop function today_board();
create function today_board() returns table (
  room_id uuid, property_id uuid, room_no text, room_type_code text, day_status day_status, day_status_source text,
  block_id uuid, block_reason text, block_until date,
  cleaning_id uuid, cleaning_status cleaning_status, cleaning_type cleaning_type,
  hk_id uuid, hk_name text, members text[], started_at timestamptz, check_started_at timestamptz,
  finished_at timestamptz,
  hk_state text, hk_state_at timestamptz, occupied boolean, departing boolean, arriving boolean)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid() and active),
       today as (select (now() at time zone 'Europe/Istanbul')::date as d)
  select r.id, r.property_id, r.room_no, rt.code, ds.status, ds.source,
         b.id, b.reason, b.end_date,
         c.id, c.status, c.type, c.hk_id, hp.full_name,
         (select array_agg(p.full_name order by p.full_name) from cleaning_members m join profiles p on p.id = m.profile_id
          where m.cleaning_id = c.id),
         c.started_at, c.check_started_at, c.finished_at,
         hs.hk_state, hs.hk_state_at, hs.occupied, hs.departing, hs.arriving
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
  where me.role = 'admin' or pr.region = me.region
  order by pr.name, r.room_no
$$;
revoke execute on function today_board() from anon, public;
grant execute on function today_board() to authenticated;
