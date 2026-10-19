-- TTLock: oda ↔ kilit eşleşmesi, kapı açma kayıtları, TTLock oturum anahtarı (karar 16).
-- Kapı `ttlock-unlock` Edge Function'ı ile ağ geçidi üzerinden açılır; tarayıcı TTLock'a hiç bağlanmaz.

alter table rooms add column ttlock_lock_id bigint unique;

-- Her kapı açma denemesi (başarılı/başarısız). Sadece Edge Function (service role) yazar.
create table door_unlocks (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references rooms(id),
  profile_id  uuid not null references profiles(id),
  cleaning_id uuid,                 -- temizlik başlatırken açıldıysa (kayıt kuyruktan sonra oluşur, o yüzden FK yok)
  at          timestamptz not null default now(),
  ok          boolean not null,
  error       text
);
create index on door_unlocks (room_id, at desc);
create index on door_unlocks (profile_id, at desc);
create index on door_unlocks (cleaning_id) where cleaning_id is not null;

alter table door_unlocks enable row level security;
create policy admin_read on door_unlocks for select using (is_admin());
create policy sup_read on door_unlocks for select using (is_region_sup(room_id));
create policy own_read on door_unlocks for select using (profile_id = auth.uid());

-- TTLock erişim anahtarı önbelleği: tek satır, sadece service role (politika yok → kimse okuyamaz)
create table ttlock_token (
  id           int primary key default 1 check (id = 1),
  access_token text not null,
  expires_at   timestamptz not null
);
alter table ttlock_token enable row level security;
revoke all on ttlock_token from anon, authenticated, public;

-- Kilit numaraları: Airtable "Tare Resevations" → TTlock tablosu (32 kilit)
update rooms r set ttlock_lock_id = v.lock_id
from (values
  ('Tare Houses Hotel', '101', 16484336), ('Tare Houses Hotel', '102', 16484522), ('Tare Houses Hotel', '103', 16484562),
  ('Tare Houses Hotel', '104', 16484592), ('Tare Houses Hotel', '201', 16484656), ('Tare Houses Hotel', '202', 16484698),
  ('Tare Houses Hotel', '203', 16484716), ('Tare Houses Hotel', '204', 16484734), ('Tare Houses Hotel', '301', 16484882),
  ('Tare Houses Hotel', '302', 16484924), ('Tare Houses Hotel', '303', 16484926), ('Tare Houses Hotel', '304', 16484958),
  ('Tare Houses Hotel', '401', 16484980), ('Tare Houses Hotel', '402', 16484996), ('Tare Houses Hotel', '403', 16485006),
  ('Tare Houses Hotel', '404', 16485032), ('Tare Houses Hotel', '501', 16485170),
  ('Tare Suites Beşiktaş', '101', 23841760), ('Tare Suites Beşiktaş', '201', 23841910), ('Tare Suites Beşiktaş', '202', 23841984),
  ('Tare Suites Beşiktaş', '301', 23842058), ('Tare Suites Beşiktaş', '302', 23842094),
  ('Tare Suites Urla', '101', 22579350), ('Tare Suites Urla', '102', 22579424), ('Tare Suites Urla', '201', 22579544),
  ('Tare Suites Urla', '202', 22579606), ('Tare Suites Urla', '203', 22579674), ('Tare Suites Urla', '204', 22579802),
  ('Tare Suites Urla', '301', 22579898), ('Tare Suites Urla', '302', 22579934), ('Tare Suites Urla', '303', 22579972),
  ('Tare Suites Urla', '304', 22580022)
) as v(property, room_no, lock_id)
join properties p on p.name = v.property
where r.property_id = p.id and r.room_no = v.room_no;
