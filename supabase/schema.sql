-- HK Kontrol — başlangıç şeması v2 (Supabase / Postgres)
-- Claude Code bu dosyayı ilk migration olarak kullanmalı: supabase/migrations/0001_init.sql
-- Medya dosyaları Cloudflare R2'de; tablolarda sadece R2 anahtarı (media_key) tutulur.

create extension if not exists pgcrypto;

-- ---------- Enum'lar ----------
create type user_role       as enum ('hk', 'supervisor', 'admin');
create type region          as enum ('istanbul', 'izmir');
create type cleaning_type   as enum ('full', 'stayover');            -- tam kontrol / konaklama kontrolü
create type day_status      as enum ('stayover', 'checkout', 'vacant', 'checkin', 'checkout_checkin');
create type cleaning_status as enum ('in_progress', 'submitted', 'analyzing', 'fixing', 'escalated', 'approved', 'cancelled');
create type ai_status       as enum ('pending', 'ok', 'warn', 'fail', 'unclear');
create type issue_status    as enum ('open', 'resolved');
create type damage_status   as enum ('open', 'in_progress', 'resolved');
create type lost_status     as enum ('stored', 'returned', 'disposed');

-- ---------- Organizasyon ----------
create table properties (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  city          text not null,
  region        region not null,
  district      text,
  floors        int,
  pms_name      text,                       -- HotelRunner'daki adı
  created_at    timestamptz not null default now()
);

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  username    text unique,
  role        user_role not null default 'hk',
  region      region,                       -- hk ve supervisor için zorunlu
  active      boolean not null default true,
  consent_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint region_required check (role = 'admin' or region is not null)
);

-- ---------- Oda tipi, adımlar, demirbaş ----------
create table room_types (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,     -- X3
  name                  text not null,            -- Deluxe Double
  property_id           uuid references properties(id),
  bed_type              text,
  max_guests            int,
  has_kitchen           boolean,
  bath_type             text,
  approx_m2             numeric,
  min_minutes_full      int not null default 25,  -- bundan kısa temizlik "şüpheli"
  min_minutes_stayover  int not null default 10,
  note                  text
);

create table check_steps (
  id              uuid primary key default gen_random_uuid(),
  room_type_id    uuid not null references room_types(id) on delete cascade,
  step_order      int  not null,
  zone            text not null,
  title           text not null,
  instruction     text not null,
  checks          text[] not null default '{}',
  ai_prompt       text,
  applies_to      cleaning_type[] not null default '{full,stayover}',
  required        boolean not null default true,
  needs_flash     boolean not null default false,
  shots           int not null default 1,          -- bu adımda kaç kare
  reference_key   text,                            -- R2: referans fotoğraf
  unique (room_type_id, step_order)
);

create table expected_items (
  id         uuid primary key default gen_random_uuid(),
  step_id    uuid not null references check_steps(id) on delete cascade,
  item_key   text not null,
  label      text not null,
  qty        int  not null check (qty >= 0),
  verified   boolean not null default false,
  unique (step_id, item_key)
);

create table rooms (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references properties(id) on delete cascade,
  room_type_id  uuid not null references room_types(id),
  room_no       text not null,
  floor         int,
  qr_token      text not null unique default encode(gen_random_bytes(12), 'hex'),
  active        boolean not null default true,
  note          text,
  unique (property_id, room_no)
);

-- ---------- Günlük oda durumu (HotelRunner) ----------
create table room_day_status (
  room_id     uuid not null references rooms(id) on delete cascade,
  day         date not null,
  status      day_status not null,
  source      text not null default 'hotelrunner_upload',  -- hotelrunner_upload | manual | hotelrunner_api
  updated_by  uuid references profiles(id),
  updated_at  timestamptz not null default now(),
  primary key (room_id, day)
);

-- ---------- Temizlik ----------
create table cleanings (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id),
  day              date not null default (now() at time zone 'Europe/Istanbul')::date,
  hk_id            uuid not null references profiles(id),
  type             cleaning_type not null,
  status           cleaning_status not null default 'in_progress',
  started_at       timestamptz not null default now(),
  check_started_at timestamptz,
  finished_at      timestamptz,
  started_via_qr   boolean not null default true,
  fix_attempts     int not null default 0,
  ai_overall       ai_status not null default 'pending',
  approved_by_ai   boolean not null default false,
  escalated_at     timestamptz,
  reviewed_by      uuid references profiles(id),
  reviewed_at      timestamptz,
  review_note      text,
  complaint        boolean not null default false,
  complaint_note   text,
  video_key        text,                            -- Faz 3
  created_at       timestamptz not null default now()
);
create index on cleanings (room_id, started_at desc);
create index on cleanings (hk_id, started_at desc);
create index on cleanings (status);

create table cleaning_members (                     -- birlikte temizleyen
  cleaning_id uuid not null references cleanings(id) on delete cascade,
  profile_id  uuid not null references profiles(id),
  primary key (cleaning_id, profile_id)
);

create table step_results (
  id               uuid primary key default gen_random_uuid(),
  cleaning_id      uuid not null references cleanings(id) on delete cascade,
  step_id          uuid not null references check_steps(id),
  attempt          int  not null default 1,
  shot             int  not null default 1,
  media_key        text,
  captured_at      timestamptz,
  media_deleted_at timestamptz,
  skipped          boolean not null default false,
  skip_reason      text,
  ai_status        ai_status not null default 'pending',
  ai_result        jsonb,
  ai_false_alarm   boolean not null default false,
  unique (cleaning_id, step_id, attempt, shot)
);

create table ai_queue (
  step_result_id uuid primary key references step_results(id) on delete cascade,
  enqueued_at    timestamptz not null default now(),
  tries          int not null default 0,
  last_error     text
);

create table ai_usage (
  id             bigserial primary key,
  step_result_id uuid references step_results(id) on delete set null,
  model          text not null,
  input_tokens   int,
  output_tokens  int,
  created_at     timestamptz not null default now()
);

-- ---------- Açık demirbaş eksikleri ----------
create table inventory_issues (
  id                  uuid primary key default gen_random_uuid(),
  room_id             uuid not null references rooms(id) on delete cascade,
  expected_item_id    uuid not null references expected_items(id),
  expected_qty        int not null,
  observed_qty        int,
  status              issue_status not null default 'open',
  opened_at           timestamptz not null default now(),
  opened_cleaning_id  uuid references cleanings(id),
  last_seen_at        timestamptz not null default now(),
  resolved_at         timestamptz,
  resolved_by         uuid references profiles(id),     -- null = otomatik kapandı
  resolved_cleaning_id uuid references cleanings(id),
  note                text
);
create unique index one_open_issue_per_item on inventory_issues (room_id, expected_item_id) where status = 'open';

-- ---------- Hasar ve kayıp eşya ----------
create table damage_reports (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms(id),
  reported_by  uuid not null references profiles(id),
  category     text not null,        -- mobilya, elektrik, tesisat, boya/duvar, cihaz, tekstil, diğer
  description  text not null,
  status       damage_status not null default 'open',
  cleaning_id  uuid references cleanings(id),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references profiles(id),
  resolve_note text
);

create table lost_items (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references rooms(id),
  found_by      uuid not null references profiles(id),
  found_at      timestamptz not null default now(),
  description   text not null,
  stored_at     text,                 -- resepsiyon, emanet dolabı ...
  status        lost_status not null default 'stored',
  closed_at     timestamptz,
  closed_by     uuid references profiles(id),
  returned_to   text,
  close_note    text
);

create table report_media (           -- hasar ve kayıp eşya fotoğrafları
  id               uuid primary key default gen_random_uuid(),
  damage_id        uuid references damage_reports(id) on delete cascade,
  lost_id          uuid references lost_items(id) on delete cascade,
  media_key        text not null,
  media_deleted_at timestamptz,
  created_at       timestamptz not null default now(),
  constraint one_parent check ((damage_id is null) <> (lost_id is null))
);

-- ---------- Bildirimler ve ayarlar ----------
create table notifications (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  kind        text not null,          -- escalated, inventory_missing, damage, lost_item, ...
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

create table push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  endpoint    text not null unique,
  keys        jsonb not null,
  created_at  timestamptz not null default now()
);

create table settings (key text primary key, value jsonb not null);
insert into settings (key, value) values
  ('media_retention_days', '15'),
  ('damage_media_retention_days_after_close', '90'),
  ('lost_media_retention_days_after_close', '365'),
  ('manual_approval_required', 'false'),
  ('max_fix_attempts', '2'),
  ('kvkk_text', '"KVKK aydınlatma metni buraya. Admin panelinden düzenlenecek."');

-- ---------- Yardımcı fonksiyonlar ----------
create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

create or replace function my_region() returns region
language sql stable security definer set search_path = public as
$$ select region from profiles where id = auth.uid() and active $$;

create or replace function room_region(r uuid) returns region
language sql stable security definer set search_path = public as
$$ select p.region from rooms ro join properties p on p.id = ro.property_id where ro.id = r $$;

create or replace function is_admin() returns boolean
language sql stable as $$ select coalesce(my_role() = 'admin', false) $$;

create or replace function is_region_sup(r uuid) returns boolean
language sql stable as $$ select coalesce(my_role() = 'supervisor' and room_region(r) = my_region(), false) $$;

-- ---------- RLS ----------
do $$ declare t text; begin
  foreach t in array array['properties','profiles','room_types','check_steps','expected_items','rooms',
    'room_day_status','cleanings','cleaning_members','step_results','ai_queue','ai_usage','inventory_issues',
    'damage_reports','lost_items','report_media','notifications','push_subscriptions','settings']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy admin_all on %I for all using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

-- Herkes (giriş yapmış): şablonlar ve ayarlar okunur
create policy read_room_types on room_types     for select using (auth.uid() is not null);
create policy read_steps      on check_steps    for select using (auth.uid() is not null);
create policy read_expected   on expected_items for select using (auth.uid() is not null);
create policy read_settings   on settings       for select using (auth.uid() is not null);

-- Profil
create policy own_profile        on profiles for select using (id = auth.uid());
create policy region_profiles    on profiles for select using (my_role() in ('hk','supervisor') and region = my_region());
create policy own_consent_update on profiles for update using (id = auth.uid())
  with check (id = auth.uid() and role = my_role() and region is not distinct from my_region());

-- Bölge okuma
create policy region_properties on properties      for select using (region = my_region());
create policy region_rooms      on rooms           for select using (room_region(id) = my_region());
create policy region_day_read   on room_day_status for select using (room_region(room_id) = my_region());
create policy sup_day_write     on room_day_status for all using (is_region_sup(room_id)) with check (is_region_sup(room_id));

-- Temizlik: süpervizör bölgesini yönetir; HK kendi kaydını
create policy sup_cleanings on cleanings for all using (is_region_sup(room_id)) with check (is_region_sup(room_id));
create policy hk_read_own   on cleanings for select using (hk_id = auth.uid()
  or exists (select 1 from cleaning_members m where m.cleaning_id = id and m.profile_id = auth.uid()));
-- "Bugün" ekranında odanın durumunu (kim temizliyor) görebilmek için bölgedeki bugünkü kayıtlar okunur
create policy hk_read_today on cleanings for select using (my_role() = 'hk' and room_region(room_id) = my_region()
  and day = (now() at time zone 'Europe/Istanbul')::date);
create policy hk_insert on cleanings for insert with check (hk_id = auth.uid() and room_region(room_id) = my_region()
  and status = 'in_progress');
-- HK sadece kendi kaydında ve sadece in_progress/fixing iken günceller; status geçişleri RPC ile yapılmalı (aşağıdaki nota bak)
create policy hk_update on cleanings for update using (hk_id = auth.uid() and status in ('in_progress','fixing'))
  with check (hk_id = auth.uid() and status in ('in_progress','fixing','submitted','analyzing'));

create policy sup_members on cleaning_members for all
  using (exists (select 1 from cleanings c where c.id = cleaning_id and is_region_sup(c.room_id)))
  with check (exists (select 1 from cleanings c where c.id = cleaning_id and is_region_sup(c.room_id)));
create policy hk_members on cleaning_members for all
  using (exists (select 1 from cleanings c where c.id = cleaning_id and c.hk_id = auth.uid()))
  with check (exists (select 1 from cleanings c where c.id = cleaning_id and c.hk_id = auth.uid() and c.status = 'in_progress'));

create policy sup_steps on step_results for all
  using (exists (select 1 from cleanings c where c.id = cleaning_id and is_region_sup(c.room_id)))
  with check (exists (select 1 from cleanings c where c.id = cleaning_id and is_region_sup(c.room_id)));
create policy hk_steps_read on step_results for select
  using (exists (select 1 from cleanings c where c.id = cleaning_id and c.hk_id = auth.uid()));
create policy hk_steps_insert on step_results for insert
  with check (exists (select 1 from cleanings c where c.id = cleaning_id and c.hk_id = auth.uid() and c.status in ('in_progress','fixing'))
              and ai_status = 'pending' and ai_result is null);

-- Açık eksikler: bölge okur, süpervizör kapatır (açma/otomatik kapama service role ile)
create policy region_issues_read on inventory_issues for select using (room_region(room_id) = my_region());
create policy sup_issues_update  on inventory_issues for update using (is_region_sup(room_id)) with check (is_region_sup(room_id));

-- Hasar ve kayıp eşya: HK bölgesinde açar ve okur, süpervizör yönetir
create policy hk_damage_insert on damage_reports for insert with check (reported_by = auth.uid() and room_region(room_id) = my_region());
create policy region_damage_read on damage_reports for select using (room_region(room_id) = my_region());
create policy sup_damage on damage_reports for update using (is_region_sup(room_id)) with check (is_region_sup(room_id));
create policy hk_lost_insert on lost_items for insert with check (found_by = auth.uid() and room_region(room_id) = my_region());
create policy region_lost_read on lost_items for select using (room_region(room_id) = my_region());
create policy sup_lost on lost_items for update using (is_region_sup(room_id)) with check (is_region_sup(room_id));
create policy report_media_read on report_media for select using (
  exists (select 1 from damage_reports d where d.id = damage_id and room_region(d.room_id) = my_region())
  or exists (select 1 from lost_items l where l.id = lost_id and room_region(l.room_id) = my_region()));
create policy report_media_insert on report_media for insert with check (
  exists (select 1 from damage_reports d where d.id = damage_id and d.reported_by = auth.uid())
  or exists (select 1 from lost_items l where l.id = lost_id and l.found_by = auth.uid()));

-- Bildirim ve push: herkes kendininkini
create policy own_notifications on notifications for select using (user_id = auth.uid());
create policy own_notifications_read on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_push on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- NOTLAR (Claude Code için):
-- * Durum geçişleri (submit, start_check, request_fix, approve, escalate) security definer RPC fonksiyonlarıyla yapılmalı;
--   HK'nın ai_overall, approved_by_ai, reviewed_by gibi alanları doğrudan değiştirememesi için kolon bazlı kısıt
--   (trigger veya RPC) ekle.
-- * AI sonuçları, inventory_issues açma/kapama ve notifications yazımı service role (Edge Function) ile yapılır.
-- * R2 erişimi: Edge Function, kullanıcının bu RLS kurallarına göre görebildiği kayıt için süreli imzalı URL üretir.
-- * RLS'i HK / İstanbul süpervizörü / İzmir süpervizörü / admin kullanıcılarıyla otomatik testle doğrula.
