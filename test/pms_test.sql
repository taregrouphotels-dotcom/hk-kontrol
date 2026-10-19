-- HotelRunner senkronu: oda durumu hesabı (pms_apply_day_status). İçe aktarma testinden sonra aynı veritabanında çalışır
-- (Excel'deki oteller ve odalar yüklü). Edge Function'ın yazdığı satırlar service_role olarak taklit edilir.
\set ON_ERROR_STOP 1
set client_min_messages = notice;

create temp table d as select (now() at time zone 'Europe/Istanbul')::date as today;
grant select on d to service_role, authenticated;

set role service_role;
insert into pms_reservations (line_id, hr_number, pms_name, room_no, state, checkin, checkout)
select x.* from d, lateral (values
  (1, 'A', 'Tare Houses Hotel', '101', 'confirmed', today - 2, today),          -- çıkış
  (2, 'B', 'Tare Houses Hotel', '102', 'confirmed', today, today + 3),          -- giriş
  (3, 'C', 'Tare Houses Hotel', '103', 'confirmed', today - 1, today),          -- aynı gün çıkış ...
  (4, 'D', 'Tare Houses Hotel', '103', 'reserved',  today, today + 1),          -- ... ve giriş
  (5, 'E', 'Tare Houses Hotel', '104', 'confirmed', today - 2, today + 2),      -- konaklama
  (6, 'F', 'Tare Houses Hotel', '201', 'canceled',  today - 2, today + 2),      -- iptal: boş
  (7, 'G', 'Tare Houses Hotel', '202', 'confirmed', today - 2, today + 2),      -- elle girilmiş durum korunacak
  (8, 'H', 'Tare Suites Urla',  'T1',  'confirmed', today - 1, today + 1),      -- Tiny Houses (PMS'te Suites Urla altında)
  (9, 'I', 'Tare Houses Hotel', '999', 'confirmed', today, today + 2),          -- uygulamada olmayan oda
  (10, 'J', 'Tare Houses Hotel', null, 'confirmed', today, today + 1)           -- oda atanmamış
) as x(line_id, hr_number, pms_name, room_no, state, checkin, checkout);
reset role;

-- Süpervizör 202'yi bugün için elle "boş" yapmış
insert into room_day_status (room_id, day, status, source)
select r.id, d.today, 'vacant', 'manual' from rooms r join properties p on p.id = r.property_id, d
where p.name = 'Tare Houses Hotel' and r.room_no = '202';

set role service_role;
create temp table res as select pms_apply_day_status(array['Tare Houses Hotel', 'Tare Suites Urla']) v;
reset role;

create function pg_temp.st(prop text, no text, plus int) returns text language sql as $$
  select s.status::text from room_day_status s join rooms r on r.id = s.room_id join properties p on p.id = r.property_id, d
  where p.name = prop and r.room_no = no and s.day = d.today + plus $$;

select t.eq(pg_temp.st('Tare Houses Hotel', '101', 0), 'checkout', 'sadece çıkış: checkout');
select t.eq(pg_temp.st('Tare Houses Hotel', '101', 1), 'vacant', 'ertesi gün boş');
select t.eq(pg_temp.st('Tare Houses Hotel', '102', 0), 'checkin', 'sadece giriş: checkin');
select t.eq(pg_temp.st('Tare Houses Hotel', '102', 1), 'stayover', 'girişin ertesi günü konaklama');
select t.eq(pg_temp.st('Tare Houses Hotel', '103', 0), 'checkout_checkin', 'aynı gün çıkış ve giriş');
select t.eq(pg_temp.st('Tare Houses Hotel', '104', 0), 'stayover', 'giriş < bugün < çıkış: konaklama');
select t.eq(pg_temp.st('Tare Houses Hotel', '201', 0), 'vacant', 'iptal rezervasyon sayılmaz');
select t.eq(pg_temp.st('Tare Houses Hotel', '202', 0), 'vacant', 'elle girilen durum senkronla ezilmez');
select t.eq((select source from room_day_status s join rooms r on r.id = s.room_id join properties p on p.id = r.property_id, d
             where p.name = 'Tare Houses Hotel' and r.room_no = '202' and s.day = d.today), 'manual', 'elle girilen kaynak korunur');
select t.eq(pg_temp.st('Tare Houses Hotel', '202', 1), 'stayover', 'elle girilen sadece o gün için geçerli');
select t.eq(pg_temp.st('Tiny Houses', 'T1', 0), 'stayover', 'Tiny Houses odası Suites Urla rezervasyonundan');
select t.eq(pg_temp.st('Tare Suites Urla', '101', 0), 'vacant', 'rezervasyonu olmayan oda boş');
select t.eq(pg_temp.st('Tare Village Urla', '101', 0), null, 'senkronlanmayan tesise dokunulmaz');
select t.eq((select jsonb_array_length(v->'unmatched') from res), 2, 'eşleşmeyen ve oda atanmamış rezervasyon uyarısı');

-- Yetki
set role authenticated;
select t.as_user('00000000-0000-0000-0000-0000000000a1');
select t.eq((select count(*) from pms_reservations), 0::bigint, 'HK HotelRunner kayıtlarını göremez');
select t.as_user('00000000-0000-0000-0000-0000000000c1');
select t.eq((select count(*) from pms_reservations), 10::bigint, 'admin HotelRunner kayıtlarını görür');
do $$ begin
  perform pms_apply_day_status(array['Tare Houses Hotel']);
  raise exception 'BAŞARISIZ: tarayıcıdan durum hesabı çağrılabildi';
exception when insufficient_privilege then raise notice 'tamam: durum hesabı sadece sunucudan çağrılır';
end $$;
do $$ begin
  perform check_cron_key('x');
  raise exception 'BAŞARISIZ: cron anahtarı tarayıcıdan denenebildi';
exception when insufficient_privilege then raise notice 'tamam: cron anahtarı tarayıcıdan denenemez';
end $$;
reset role;
\echo 'HOTELRUNNER TESTLERİ GEÇTİ'
