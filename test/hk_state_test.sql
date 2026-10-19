-- Oda temiz/kirli ve doluluk hesabı (room_hk_state). İçe aktarma testinden sonra aynı veritabanında çalışır.
-- Sabit bir gün (10.05.2026) ve saatlerle: çıkış 12:00, giriş 14:00.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create or replace function t.fails(sql text, msg text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'tamam: % (%)', msg, sqlerrm; return; end;
  raise exception 'BAŞARISIZ: % hata vermeliydi', msg;
end $$;
grant execute on all functions in schema t to authenticated;

delete from pms_reservations;
delete from room_day_status;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000aa01', 'hk@test');
insert into profiles (id, full_name, username, role, region) values
  ('00000000-0000-0000-0000-00000000aa01', 'HK Test', 'hktest', 'hk', 'istanbul');

create function pg_temp.room(no text) returns uuid language sql as $$
  select r.id from rooms r join properties p on p.id = r.property_id where p.name = 'Tare Houses Hotel' and r.room_no = no $$;
create function pg_temp.at(day int, hm text) returns timestamptz language sql as $$
  select (('2026-05-10'::date + day) + hm::time) at time zone 'Europe/Istanbul' $$;
create function pg_temp.ds(no text, day int, s day_status) returns void language sql as $$
  insert into room_day_status (room_id, day, status, source) values (pg_temp.room(no), '2026-05-10'::date + day, s, 'hotelrunner_api') $$;
create function pg_temp.clean(no text, day int, start_hm text, end_hm text, typ cleaning_type default 'full') returns void language sql as $$
  insert into cleanings (room_id, day, hk_id, type, status, started_at, check_started_at, finished_at)
  values (pg_temp.room(no), '2026-05-10'::date + day, '00000000-0000-0000-0000-00000000aa01', typ, 'submitted',
          pg_temp.at(day, start_hm), pg_temp.at(day, start_hm), pg_temp.at(day, end_hm)) $$;
create function pg_temp.s(no text, day int, hm text) returns text language sql as $$
  select hk_state from room_hk_state(pg_temp.room(no), pg_temp.at(day, hm)) $$;
create function pg_temp.occ(no text, day int, hm text) returns text language sql as $$
  select concat_ws('/', occupied, departing, arriving) from room_hk_state(pg_temp.room(no), pg_temp.at(day, hm)) $$;

-- 301: bugün çıkış, temizlik 13:00–13:40
select pg_temp.ds('301', 0, 'checkout');
select t.eq(pg_temp.s('301', 0, '11:00'), 'unknown', 'çıkıştan önce kayıt yoksa bilinmiyor');
select t.eq(pg_temp.occ('301', 0, '11:00'), 't/t/f', '12:00 öncesi misafir içeride, çıkış bekleniyor');
select t.eq(pg_temp.s('301', 0, '12:30'), 'dirty', '12:00 sonrası çıkış odası kirli');
select t.eq(pg_temp.occ('301', 0, '12:30'), 'f/f/f', '12:00 sonrası çıkış odası boş');
select pg_temp.clean('301', 0, '13:00', '13:40');
select t.eq(pg_temp.s('301', 0, '13:20'), 'dirty', 'temizlik bitmeden kirli');
select t.eq(pg_temp.s('301', 0, '13:50'), 'clean', 'temizlik gönderilince temiz');
select pg_temp.ds('301', 1, 'vacant');
select t.eq(pg_temp.s('301', 1, '09:00'), 'clean', 'ertesi gün boş oda temiz kalır');

-- 302: erken çıkış, 10:00'da temizlendi
select pg_temp.ds('302', 0, 'checkout');
select pg_temp.clean('302', 0, '10:00', '10:45');
select t.eq(pg_temp.s('302', 0, '12:30'), 'clean', '12:00 öncesi temizlenen çıkış odası 12:00 sonra da temiz');

-- 303: aynı gün çıkış + giriş
select pg_temp.ds('303', 0, 'checkout_checkin');
select t.eq(pg_temp.occ('303', 0, '11:00'), 't/t/t', 'çık+gir: 12:00 öncesi dolu, çıkış ve giriş bekleniyor');
select t.eq(pg_temp.s('303', 0, '12:30'), 'dirty', 'çık+gir: 12:00 sonrası kirli');
select pg_temp.clean('303', 0, '12:30', '13:10');
select t.eq(pg_temp.s('303', 0, '13:30'), 'clean', 'çık+gir: temizlendi');
select t.eq(pg_temp.occ('303', 0, '13:30'), 'f/f/t', 'çık+gir: 12–14 arası boş, giriş bekleniyor');
select t.eq(pg_temp.occ('303', 0, '14:30'), 't/f/f', 'çık+gir: 14:00 sonrası dolu');

-- 304: rezervasyon geçmişinden (günlük durum kaydı olmayan eski günler)
insert into pms_reservations (line_id, hr_number, pms_name, room_no, state, checkin, checkout) values
  (901, 'X', 'Tare Houses Hotel', '304', 'confirmed', '2026-05-01', '2026-05-07');
select pg_temp.ds('304', 0, 'vacant');
select t.eq(pg_temp.s('304', 0, '09:00'), 'dirty', 'eski çıkıştan sonra temizlenmemiş boş oda kirli');
select pg_temp.clean('304', -3, '12:10', '12:50');
select t.eq(pg_temp.s('304', 0, '09:00'), 'clean', 'eski çıkıştan sonra temizlenmiş oda temiz');
insert into pms_reservations (line_id, hr_number, pms_name, room_no, state, checkin, checkout) values
  (902, 'Y', 'Tare Houses Hotel', '304', 'canceled', '2026-05-08', '2026-05-09');
select t.eq(pg_temp.s('304', 0, '09:00'), 'clean', 'iptal rezervasyonun çıkışı sayılmaz');

-- 401: giriş günü, oda temiz işaretli
select pg_temp.ds('401', 0, 'checkin');
insert into room_hk_marks (room_id, clean, at) values (pg_temp.room('401'), true, pg_temp.at(-1, '18:00'));
select t.eq(pg_temp.s('401', 0, '10:00'), 'clean', 'elle temiz işaretlenen oda temiz');
select t.eq(pg_temp.occ('401', 0, '10:00'), 'f/f/t', 'giriş: 14:00 öncesi boş, giriş bekleniyor');
select t.eq(pg_temp.occ('401', 0, '15:00'), 't/f/f', 'giriş: 14:00 sonrası dolu');
insert into room_hk_marks (room_id, clean, at) values (pg_temp.room('401'), false, pg_temp.at(0, '09:00'));
select t.eq(pg_temp.s('401', 0, '10:00'), 'dirty', 'sonradan kirli işaretlenirse kirli');

-- 402: konaklama
select pg_temp.ds('402', 0, 'stayover');
select t.eq(pg_temp.occ('402', 0, '10:00'), 't/f/f', 'konaklama: dolu');
select pg_temp.clean('402', 0, '10:00', '10:20', 'stayover');
select t.eq(pg_temp.s('402', 0, '11:00'), 'clean', 'konaklama temizliği de temiz sayılır');

-- AI: fotoğraf kuyruğa girer, kaydın genel sonucu en kötü adımdır, yanlış alarm düşer (0015)
create temp table ai_c as select c.id, c.room_id from cleanings c where c.room_id = pg_temp.room('301') limit 1;
create temp table ai_s as select s.id from check_steps s join rooms r on r.room_type_id = s.room_type_id
  where r.id = pg_temp.room('301') order by s.step_order limit 2;
insert into step_results (cleaning_id, step_id, shot, attempt, media_key)
  select (select id from ai_c), id, 1, 1, 'k/' || id from ai_s;
select t.eq((select count(*) from ai_queue q join step_results r on r.id = q.step_result_id where r.cleaning_id = (select id from ai_c)),
            2::bigint, 'yüklenen fotoğraflar AI kuyruğuna girer');
update step_results set ai_status = 'ok' where cleaning_id = (select id from ai_c);
update step_results set ai_status = 'fail' where cleaning_id = (select id from ai_c) and step_id = (select min(id::text)::uuid from ai_s);
select refresh_cleaning_ai((select id from ai_c));
select t.eq((select ai_overall::text from cleanings where id = (select id from ai_c)), 'fail', 'kaydın AI sonucu en kötü adım');
update step_results set ai_false_alarm = true where cleaning_id = (select id from ai_c) and step_id = (select min(id::text)::uuid from ai_s);
select t.eq((select ai_overall::text from cleanings where id = (select id from ai_c)), 'ok', 'yanlış alarm işaretlenince sorun düşer');
insert into step_results (cleaning_id, step_id, shot, attempt, media_key, ai_status)
  values ((select id from ai_c), (select min(id::text)::uuid from ai_s), 1, 2, 'k/x2', 'warn');
select refresh_cleaning_ai((select id from ai_c));
select t.eq((select ai_overall::text from cleanings where id = (select id from ai_c)), 'warn', 'tekrar çekilen karenin son denemesi sayılır');

-- Otomatik onay ayarı (0019): kapalıyken onay süpervizörde, açıkken tüm adımlar ok ise onaylanır
update step_results set ai_status = 'ok', ai_false_alarm = false where cleaning_id = (select id from ai_c);
update cleanings set status = 'in_progress', check_started_at = started_at where id = (select id from ai_c);
update cleanings set status = 'submitted' where id = (select id from ai_c);
select t.eq((select status::text from cleanings where id = (select id from ai_c)), 'submitted', 'otomatik onay kapalıyken süpervizöre gider');
update settings set value = 'false' where key = 'manual_approval_required';
select refresh_cleaning_ai((select id from ai_c));
select t.eq((select status::text || '/' || approved_by_ai from cleanings where id = (select id from ai_c)), 'approved/true',
            'otomatik onay açıkken tüm adımları geçen kayıt onaylanır');
update settings set value = 'true' where key = 'manual_approval_required';

-- AI demirbaş sayımı (0019): eksik açılır, tamsa kapanır
create temp table inv as
  select e.id, e.item_key, e.qty, e.step_id from expected_items e join rooms r on r.room_type_id = e.room_type_id
  where r.id = pg_temp.room('303') and e.step_id is not null and e.qty > 1 limit 1;
insert into cleanings (id, room_id, day, hk_id, type, status, started_at)
  values ('70000000-0000-0000-0000-000000000001', pg_temp.room('303'), '2026-05-11', '00000000-0000-0000-0000-00000000aa01', 'full', 'in_progress', now());
insert into step_results (id, cleaning_id, step_id, shot, attempt, media_key)
  select '70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', step_id, 1, 1, 'k/inv' from inv;
select apply_inventory('70000000-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('key', (select item_key from inv), 'seen', (select qty - 1 from inv))));
select t.eq((select count(*) from inventory_issues where status = 'open'), 1::bigint, 'AI eksik sayınca açık eksik açılır');
select t.eq((select count(*) from notifications where kind = 'inventory_missing') > 0, true, 'eksik için bildirim');
select apply_inventory('70000000-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('key', (select item_key from inv), 'seen', (select qty from inv))));
select t.eq((select count(*) from inventory_issues where status = 'resolved' and resolved_by is null), 1::bigint, 'tam sayılınca eksik kendiliğinden kapanır');

-- Saklama (0019): 15 günden eski fotoğraf silinecekler listesinde, şikayetli kayıt değil
update step_results set captured_at = now() - interval '20 days' where cleaning_id = (select id from ai_c);
select t.eq((select count(*) from media_to_delete() where kind = 'step') >= 2, true, '15 günü geçen fotoğraf silinecek');
update cleanings set complaint = true where id = (select id from ai_c);
select t.eq((select count(*) from media_to_delete() m join step_results r on r.id = m.id where r.cleaning_id = (select id from ai_c)), 0::bigint,
            'şikayetli kaydın fotoğrafı silinmez');

-- Müşteri temizlik talebi (0016): bugün girilen talep görünür, sonradan gönderilen temizlik kapatır
insert into cleaning_requests (room_id, requested_at) values (pg_temp.room('402'), now() - interval '1 minute');
create temp table rid as select pg_temp.room('402') r402, pg_temp.room('403') r403;
grant select on rid to authenticated;

-- Bugün ekranı yeni sütunlarla çalışır
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000aa01');
select t.eq((select cleaning_requested_at is not null from today_board() where room_id = (select r402 from rid)), true,
            'müşteri temizlik talebi Bugün ekranında görünür');
select t.eq((select count(*) from cleaning_requests), 1::bigint, 'HK bölgesindeki talebi görür');
insert into cleaning_requests (room_id) values ((select r403 from rid));
select t.eq((select count(*) from cleaning_requests), 2::bigint, 'HK talep girebilir');
create temp table del_hk as with d as (delete from cleaning_requests returning 1) select count(*) n from d;
select t.eq((select n from del_hk), 0::bigint, 'HK talebi silemez');
reset role;
insert into cleanings (room_id, day, hk_id, type, status, started_at, finished_at)
  values (pg_temp.room('402'), (now() at time zone 'Europe/Istanbul')::date, '00000000-0000-0000-0000-00000000aa01', 'stayover',
          'submitted', now() - interval '30 seconds', now() - interval '10 seconds');
set role authenticated;
select t.as_user('00000000-0000-0000-0000-00000000aa01');
select t.eq((select cleaning_requested_at is null from today_board() where room_id = (select r402 from rid)), true,
            'talepten sonra temizlik gönderilince talep kapanır');
select t.eq((select count(*) > 0 from today_board() where hk_state is not null), true, 'Bugün ekranı temiz/kirli durumunu döner');
select t.fails($$ select * from room_hk_state(gen_random_uuid()) $$, 'room_hk_state doğrudan çağrılamaz');
select t.fails($$ select refresh_cleaning_ai(gen_random_uuid()) $$, 'refresh_cleaning_ai doğrudan çağrılamaz');
select t.fails($$ select * from media_to_delete() $$, 'silinecek medya listesi tarayıcıdan okunamaz');
select t.fails($$ select apply_inventory(gen_random_uuid(), '[]') $$, 'demirbaş sayımı tarayıcıdan yazılamaz');
select t.eq((select ai_stats(current_date - 30, current_date)->>'photos'), '0', 'HK AI istatistiğini göremez (sıfır döner)');
select t.fails($$ insert into room_hk_marks (room_id, clean) values ((select id from rooms limit 1), true) $$, 'HK temiz/kirli işaretleyemez');
reset role;
\echo 'ODA DURUMU TESTLERİ GEÇTİ'
