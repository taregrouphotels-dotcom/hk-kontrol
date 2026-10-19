-- Yetki (RLS) ve durum geçişi testleri. test/veritabani_test.sh çalıştırır.
-- Kullanıcılar: İstanbul HK-1, HK-2, süpervizör; İzmir HK, süpervizör; admin.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create schema t;
create function t.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create function t.eq(actual anyelement, expected anyelement, msg text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'BAŞARISIZ: % (beklenen %, gelen %)', msg, expected, actual; end if;
  raise notice 'tamam: %', msg;
end $$;
-- Hata vermesi beklenen çağrı: SQL metni çalıştırılır, hata yoksa test düşer.
create function t.fails(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'tamam: % (%)', msg, sqlerrm; return; end;
  raise exception 'BAŞARISIZ: % hata vermeliydi', msg;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- ---------- Veri ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'hk1@hk.tare.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'hk2@hk.tare.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'hkizm@hk.tare.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'sup.ist@x'),
  ('00000000-0000-0000-0000-0000000000b2', 'sup.izm@x'),
  ('00000000-0000-0000-0000-0000000000c1', 'admin@x'),
  ('00000000-0000-0000-0000-0000000000d1', 'GokcerCakir@gmail.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'yabanci@x');

-- ---------- İlk admin (henüz hiç profil yokken) ----------
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.fails($$ select claim_first_admin() $$, 'tanımsız e-posta ilk admin olamaz');
select t.as_user('00000000-0000-0000-0000-0000000000d1');
select t.eq((select role from claim_first_admin()), 'admin'::user_role, 'ilk admin e-postası admin profilini alır');
select t.eq((select role from claim_first_admin()), 'admin'::user_role, 'ilk admin tekrar girince aynı profil döner');
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.fails($$ select claim_first_admin() $$, 'admin varken başka hesap profil alamaz');
reset role;
insert into profiles (id, full_name, username, role, region) values
  ('00000000-0000-0000-0000-0000000000a1', 'HK Bir',    'hk1',   'hk',         'istanbul'),
  ('00000000-0000-0000-0000-0000000000a2', 'HK İki',    'hk2',   'hk',         'istanbul'),
  ('00000000-0000-0000-0000-0000000000a3', 'HK İzmir',  'hkizm', 'hk',         'izmir'),
  ('00000000-0000-0000-0000-0000000000b1', 'Süp İst',   null,    'supervisor', 'istanbul'),
  ('00000000-0000-0000-0000-0000000000b2', 'Süp İzm',   null,    'supervisor', 'izmir'),
  ('00000000-0000-0000-0000-0000000000c1', 'Admin',     null,    'admin',      null);

insert into properties (id, name, city, region) values
  ('10000000-0000-0000-0000-000000000001', 'Tare Houses Hotel', 'İstanbul', 'istanbul'),
  ('10000000-0000-0000-0000-000000000002', 'Tare Suites Urla',  'İzmir',    'izmir');
insert into room_types (id, code, name, property_id) values
  ('20000000-0000-0000-0000-000000000001', 'X3',  'Deluxe Double', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'EDR', 'Economy Double', '10000000-0000-0000-0000-000000000002');
insert into check_steps (id, room_type_id, step_order, zone, title, instruction, applies_to, required, shots) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 'Banyo', 'WC', 'çek', '{full,stayover}', true, 1),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 2, 'Mutfak', 'Çekmece', 'çek', '{full}', true, 1),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 3, 'Oda', 'Yatak', 'çek', '{full,stayover}', true, 2);
insert into rooms (id, property_id, room_type_id, room_no) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '103'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '203'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '101');
insert into room_day_status (room_id, day, status, source) values
  ('40000000-0000-0000-0000-000000000002', (now() at time zone 'Europe/Istanbul')::date, 'stayover', 'manual');

set role authenticated;

-- ---------- Giriş yapmamış kullanıcı ----------
select t.as_user(null);
select t.eq((select count(*) from rooms), 0::bigint, 'oturumsuz kullanıcı oda göremez');
select t.eq((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname not in ('daily_summary', 'daily_summary_auth')  -- anahtarla korunuyor (n8n Telegram özeti)
             and has_function_privilege('anon', p.oid, 'execute')), 0::bigint,
            'oturumsuz kullanıcı hiçbir fonksiyonu çağıramaz');
select t.fails($$ select daily_summary('yanlis', 'morning') $$, 'günlük özet anahtarsız çağrılamaz');
select t.fails($$ select daily_summary(null, 'morning') $$, 'günlük özet boş anahtarla çağrılamaz');
select t.fails($$ select daily_summary_auth('morning') $$, 'günlük özet başlıksız çağrılamaz');

-- ---------- HK-1: başlatma ----------
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.eq((select count(*) from rooms), 2::bigint, 'İstanbul HK sadece İstanbul odalarını görür');
select t.eq((select count(*) from properties), 1::bigint, 'İstanbul HK sadece İstanbul otelini görür');
select t.eq((select count(*) from profiles), 3::bigint, 'İstanbul HK bölgesindeki profilleri görür (birlikte temizleyen seçimi)');
select t.eq((select type from start_cleaning('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001')),
            'full'::cleaning_type, 'durumu bilinmeyen oda tam kontrol olarak başlar');
select t.eq((select day_status_unknown from cleanings where id = '50000000-0000-0000-0000-000000000001'), true,
            'durumu bilinmeyen oda etiketlenir');
select t.eq((select status from start_cleaning('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001')),
            'in_progress'::cleaning_status, 'aynı başlatma tekrar gönderilince hata vermez');
select t.eq((select type from start_cleaning('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002')),
            'stayover'::cleaning_type, 'konaklama durumundaki oda konaklama kontrolü olarak başlar');
select t.fails($$ select start_cleaning('50000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000003') $$,
            'İstanbul HK İzmir odasında temizlik başlatamaz');
select t.fails($$ select start_cleaning(gen_random_uuid(), '40000000-0000-0000-0000-000000000001', now() + interval '1 day') $$,
            'gelecek tarihli başlatma reddedilir');
select t.fails($$ insert into cleanings (room_id, hk_id, type) values
            ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'full') $$,
            'HK tabloya doğrudan kayıt ekleyemez');
update cleanings set complaint = true, reviewed_by = auth.uid() where id = '50000000-0000-0000-0000-000000000001';
select t.eq((select complaint from cleanings where id = '50000000-0000-0000-0000-000000000001'), false,
            'HK kendi kaydında şikayet/onay alanlarını değiştiremez');
update profiles set role = 'admin' where id = auth.uid();
select t.eq((select role from profiles where id = auth.uid()), 'hk'::user_role, 'HK kendi rolünü değiştiremez');
select t.eq((give_consent() is not null), true, 'KVKK onayı kaydedilir');

-- Birlikte temizleyen
select add_cleaning_member('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2');
select add_cleaning_member('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2');
select t.fails($$ select add_cleaning_member('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3') $$,
            'başka bölgedeki HK birlikte temizleyen olamaz');

-- Kontrol ve gönderme
select t.fails($$ select submit_cleaning('50000000-0000-0000-0000-000000000001') $$, 'kontrol başlamadan gönderilemez');
select start_check('50000000-0000-0000-0000-000000000001');
select t.eq((select count(*) from missing_steps('50000000-0000-0000-0000-000000000001')), 4::bigint,
            'tam kontrolde 3 adım, yatak 2 kare: 4 eksik');
insert into step_results (cleaning_id, step_id, shot, media_key) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1, 'k/1-1.jpg'),
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 1, 'k/3-1.jpg');
insert into step_results (cleaning_id, step_id, shot, skipped, skip_reason) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 1, true, 'çekmece kilitli');
select t.fails($$ insert into step_results (cleaning_id, step_id, shot, media_key, ai_status) values
            ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 2, 'x', 'ok') $$,
            'HK AI sonucunu kendisi yazamaz');
select t.fails($$ select submit_cleaning('50000000-0000-0000-0000-000000000001') $$, 'eksik kare varken gönderilemez');
insert into step_results (cleaning_id, step_id, shot, media_key) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 2, 'k/3-2.jpg');
select t.eq((select status from submit_cleaning('50000000-0000-0000-0000-000000000001')), 'submitted'::cleaning_status,
            'tüm adımlar tamamken gönderilir');
select t.eq((select status from submit_cleaning('50000000-0000-0000-0000-000000000001')), 'submitted'::cleaning_status,
            'gönderme tekrar gelince hata vermez');
select t.fails($$ insert into step_results (cleaning_id, step_id, shot, attempt, media_key) values
            ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1, 2, 'x') $$,
            'gönderilmiş kayda fotoğraf eklenemez');
select t.fails($$ select approve_cleaning('50000000-0000-0000-0000-000000000001') $$, 'HK kendi kaydını onaylayamaz');

-- ---------- HK-2: birlikte temizleyen ----------
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.eq((select count(*) from cleanings), 1::bigint, 'birlikte temizleyen sadece ortak kaydı görür, HK-1in diğer kaydını görmez');
select t.eq((select count(*) from step_results), 4::bigint, 'birlikte temizleyen ortak kaydın fotoğraflarını görür');
select t.eq((select count(*) from today_board()), 2::bigint, 'Bugün ekranı bölgedeki odaları gösterir');
select t.eq((select hk_name from today_board() where room_no = '203'), 'HK Bir', 'Bugün ekranında kimin temizlediği görünür');
select t.fails($$ select start_check('50000000-0000-0000-0000-000000000002') $$, 'başkasının kaydında kontrol başlatılamaz');

-- ---------- İzmir HK ----------
select t.as_user('00000000-0000-0000-0000-0000000000a3');
select t.eq((select count(*) from cleanings), 0::bigint, 'İzmir HK İstanbul kayıtlarını göremez');
select t.eq((select count(*) from step_results), 0::bigint, 'İzmir HK İstanbul fotoğraflarını göremez');
select t.eq((select count(*) from today_board()), 1::bigint, 'İzmir HK Bugün ekranında sadece İzmir odasını görür');

-- ---------- İzmir süpervizörü ----------
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.eq((select count(*) from cleanings), 0::bigint, 'İzmir süpervizörü İstanbul kayıtlarını göremez');
select t.eq((select count(*) from step_results), 0::bigint, 'İzmir süpervizörü İstanbul fotoğraflarını göremez');
select t.eq((select count(*) from room_day_status), 0::bigint, 'İzmir süpervizörü İstanbul oda durumlarını göremez');
select t.fails($$ select approve_cleaning('50000000-0000-0000-0000-000000000001') $$, 'İzmir süpervizörü İstanbul kaydını onaylayamaz');

-- ---------- İstanbul süpervizörü ----------
select t.as_user('00000000-0000-0000-0000-0000000000b1');
select t.eq((select count(*) from cleanings), 2::bigint, 'İstanbul süpervizörü bölgesindeki tüm kayıtları görür');
select t.eq((select count(*) from step_results), 4::bigint, 'İstanbul süpervizörü fotoğrafları görür');
select t.eq((select type from set_cleaning_type('50000000-0000-0000-0000-000000000002', 'full')), 'full'::cleaning_type,
            'süpervizör temizlik türünü değiştirir');
select t.eq((select status from approve_cleaning('50000000-0000-0000-0000-000000000001', 'iyi')), 'approved'::cleaning_status,
            'süpervizör onaylar');
select t.eq((select reviewed_by from cleanings where id = '50000000-0000-0000-0000-000000000001'),
            '00000000-0000-0000-0000-0000000000b1'::uuid, 'onaylayan kaydedilir');
select t.fails($$ select cancel_cleaning('50000000-0000-0000-0000-000000000002', '') $$, 'iptal nedeni boş olamaz');
select t.eq((select status from cancel_cleaning('50000000-0000-0000-0000-000000000002', 'yanlış oda')),
            'cancelled'::cleaning_status, 'süpervizör iptal eder');
select t.eq((select complaint from set_complaint('50000000-0000-0000-0000-000000000001', true, 'misafir şikayeti')), true,
            'süpervizör şikayet işaretler');
insert into room_day_status (room_id, day, status, source, updated_by)
  values ('40000000-0000-0000-0000-000000000001', current_date + 1, 'checkout', 'manual', auth.uid());
select t.fails($$ insert into room_day_status (room_id, day, status, source)
            values ('40000000-0000-0000-0000-000000000003', current_date, 'checkout', 'manual') $$,
            'İstanbul süpervizörü İzmir oda durumunu yazamaz');

-- Kullanım dışı (tadilat)
insert into room_blocks (room_id, start_date, end_date, reason, created_by)
  values ('40000000-0000-0000-0000-000000000001', current_date - 1, current_date + 3, 'Tadilat', auth.uid());
select t.eq((select block_reason from today_board() where room_no = '103'), 'Tadilat', 'süpervizör odayı kullanım dışı yapar');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.eq((select block_reason from today_board() where room_no = '103'), 'Tadilat', 'HK kullanım dışı odayı görür');
select t.fails($$ insert into room_blocks (room_id, start_date, end_date, reason)
            values ('40000000-0000-0000-0000-000000000001', current_date, current_date, 'x') $$, 'HK kullanım dışı giremez');
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.fails($$ insert into room_blocks (room_id, start_date, end_date, reason)
            values ('40000000-0000-0000-0000-000000000001', current_date, current_date, 'x') $$,
            'İzmir süpervizörü İstanbul odasını kullanım dışı yapamaz');

-- TTLock anahtarı sadece sunucu tarafında
reset role;
insert into ttlock_token (access_token, expires_at) values ('gizli', now() + interval '1 day');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000a2');
select t.fails($$ select * from ttlock_token $$, 'TTLock anahtarı okunamaz');

-- Hasar ve kayıp eşya (0018)
select t.as_user('00000000-0000-0000-0000-0000000000a2');
insert into damage_reports (id, room_id, reported_by, category, description) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', auth.uid(), 'Mobilya', 'Komodin kapağı kırık');
insert into lost_items (id, room_id, found_by, description, stored_at) values
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', auth.uid(), 'Siyah şarj aleti', 'Resepsiyon');
insert into report_media (damage_id, media_key) values ('60000000-0000-0000-0000-000000000001', 'x/hasar/1.jpg');
select t.fails($$ insert into damage_reports (room_id, reported_by, category, description)
            values ('40000000-0000-0000-0000-000000000001', auth.uid(), 'Uzay', 'x') $$, 'listede olmayan hasar kategorisi girilemez');
select t.fails($$ insert into damage_reports (room_id, reported_by, category, description)
            values ('40000000-0000-0000-0000-000000000003', auth.uid(), 'Mobilya', 'x') $$, 'HK başka bölgeye hasar giremez');
create temp table hk_upd as with u as (update damage_reports set status = 'resolved' returning 1) select count(*) n from u;
select t.eq((select n from hk_upd), 0::bigint, 'HK hasarı kapatamaz');
select t.eq((select count(*) from notifications), 0::bigint, 'HK başkasının bildirimini görmez');
select t.as_user('00000000-0000-0000-0000-0000000000b1');
select t.eq((select count(*) from notifications where kind in ('damage', 'lost_item')), 2::bigint, 'bölge süpervizörüne hasar ve eşya bildirimi');
update damage_reports set status = 'resolved', resolve_note = 'Değiştirildi' where id = '60000000-0000-0000-0000-000000000001';
select t.eq((select resolved_by from damage_reports where id = '60000000-0000-0000-0000-000000000001'), auth.uid(), 'kapatan süpervizör yazılır');
update lost_items set status = 'returned', returned_to = 'Misafir Ali Veli' where id = '60000000-0000-0000-0000-000000000002';
select t.eq((select closed_by is not null and closed_at is not null from lost_items where id = '60000000-0000-0000-0000-000000000002'), true,
            'eşya teslim edilince kim/ne zaman yazılır');
select t.eq((select count(*) from report_media), 1::bigint, 'süpervizör hasar fotoğrafını görür');
select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.eq((select count(*) from damage_reports) + (select count(*) from lost_items) + (select count(*) from notifications where kind = 'damage'),
            0::bigint, 'İzmir süpervizörü İstanbul hasar/eşya ve bildirimlerini görmez');

-- Uygulama gizli bilgileri (0017)
select t.fails($$ select set_app_secret('ANTHROPIC_API_KEY', 'x') $$, 'süpervizör AI anahtarı giremez');
select t.fails($$ select get_app_secret('ANTHROPIC_API_KEY') $$, 'kullanıcı AI anahtarını okuyamaz');

-- ---------- Admin ----------
select t.as_user('00000000-0000-0000-0000-0000000000c1');
select t.eq((select set_app_secret('ANTHROPIC_API_KEY', ' sk-test ') is not null), true, 'admin AI anahtarı girer');
select t.fails($$ select set_app_secret('BASKA', 'x') $$, 'listede olmayan ad girilemez');
select t.fails($$ select get_app_secret('ANTHROPIC_API_KEY') $$, 'admin de anahtarı geri okuyamaz');
select t.eq((select count(*) from app_secret_status()), 1::bigint, 'admin sadece girildiğini görür');
select t.eq((select count(*) from notifications where kind = 'damage' and user_id = auth.uid()), 1::bigint, 'admine hasar bildirimi');
select t.fails($$ select * from ttlock_token $$, 'admin de TTLock anahtarını okuyamaz');
select t.eq((select count(*) from cleanings), 2::bigint, 'admin tüm kayıtları görür');
select t.eq((select count(*) from today_board()), 3::bigint, 'admin Bugün ekranında tüm odaları görür');
select t.eq((select count(*) from rooms), 3::bigint, 'admin tüm odaları görür');

-- ---------- Pasif kullanıcı ----------
reset role;
update profiles set active = false where id = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.eq((select count(*) from rooms), 0::bigint, 'pasif kullanıcı hiçbir odayı göremez');
select t.fails($$ select start_cleaning(gen_random_uuid(), '40000000-0000-0000-0000-000000000001') $$,
            'pasif kullanıcı temizlik başlatamaz');

reset role;
\echo 'TÜM TESTLER GEÇTİ'
