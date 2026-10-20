-- Excel içe aktarma testleri (import_master_data). test/veritabani_test.sh ayrı bir veritabanında çalıştırır.
-- Veri: test/fixtures/import_payload.json (gerçek Excel'in ayrıştırılmış hali, test/excel_import_test.mjs üretir).
\set ON_ERROR_STOP 1
\set payload `cat test/fixtures/import_payload.json`
set client_min_messages = notice;

create schema t;
create function t.as_user(u uuid) returns void language sql as
$$ select set_config('request.jwt.claim.sub', u::text, false) $$;
create function t.eq(actual anyelement, expected anyelement, msg text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'BAŞARISIZ: % (beklenen %, gelen %)', msg, expected, actual; end if;
  raise notice 'tamam: %', msg;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;
create table t.res (k text primary key, v jsonb);
grant all on t.res to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'admin@x'), ('00000000-0000-0000-0000-0000000000a1', 'hk1@hk.tare.local');
insert into profiles (id, full_name, username, role, region) values
  ('00000000-0000-0000-0000-0000000000c1', 'Admin', null, 'admin', null),
  ('00000000-0000-0000-0000-0000000000a1', 'HK', 'hk1', 'hk', 'istanbul');

set role authenticated;

-- ---------- HK çağıramaz ----------
select t.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform import_master_data('{}', false);
  raise exception 'BAŞARISIZ: HK içe aktarma yapabildi';
exception when insufficient_privilege then raise notice 'tamam: HK içe aktarma yapamaz';
end $$;

-- ---------- Önizleme ----------
select t.as_user('00000000-0000-0000-0000-0000000000c1');
insert into t.res values ('preview', import_master_data(:'payload'::jsonb, false));
select t.eq((select jsonb_array_length(v->'errors') from t.res where k = 'preview'), 0, 'gerçek Excel hatasız');
select t.eq((select (v->>'applied')::boolean from t.res where k = 'preview'), false, 'önizleme hiçbir şey yazmaz');
select t.eq((select count(*) from properties), 0::bigint, 'önizlemeden sonra otel yok');
select t.eq((select (v->'counts'->'inventory'->>'skipped')::int > 0 from t.res where k = 'preview'), true,
            'adedi boş envanter satırları atlanıyor');
select t.eq((select count(*) from jsonb_array_elements((select v->'warnings' from t.res where k = 'preview')) w
             where w->>'message' like '%genel şablon%'), 0::bigint,
            'tüm oda tiplerinin adımı Excel''de, genel şablon uyarısı yok');

-- ---------- Uygulama ----------
insert into t.res values ('apply1', import_master_data(:'payload'::jsonb, true));
select t.eq((select (v->>'applied')::boolean from t.res where k = 'apply1'), true, 'içe aktarma uygulandı');
select t.eq((select count(*) from properties), 5::bigint, '5 otel');
select t.eq((select region from properties where name = 'Tiny Houses'), 'izmir'::region, 'Tiny Houses İzmir bölgesinde');
select t.eq((select count(*) from room_types), 18::bigint, '18 oda tipi');
select t.eq((select count(*) from rooms), 40::bigint, '40 oda');
select t.eq((select count(*) from check_steps s join room_types r on r.id = s.room_type_id where r.code = 'X3'), 17::bigint,
            'X3 için 17 adım');
select t.eq((select shots from check_steps s join room_types r on r.id = s.room_type_id where r.code = 'X3' and step_order = 15), 2,
            'yatak adımı 2 kare');
select t.eq((select applies_to from check_steps s join room_types r on r.id = s.room_type_id where r.code = 'X3' and step_order = 5),
            '{full}'::cleaning_type[], 'gardırop sadece tam kontrolde');
select t.eq((select count(*) from check_steps where generic), 0::bigint, 'genel şablon kullanılmadı');
select t.eq((select count(*) from room_types t where not exists (select 1 from check_steps s where s.room_type_id = t.id)), 0::bigint,
            'her oda tipinin adımı var');
select t.eq((select count(*) from check_steps s join room_types r on r.id = s.room_type_id where r.code = 'TNY'), 17::bigint,
            'Tiny House: balkon, teras, bahçe, barbekü dahil 17 adım');
select t.eq((select min_minutes_full from room_types where code = 'X1'), 25, 'boş min. süre varsayılan 25 dk');
select t.eq((select count(*) from item_catalog), (select jsonb_array_length(:'payload'::jsonb->'catalog'))::bigint, 'katalog tam');
select t.eq((select count(*) from expected_items),
            (select (v->'counts'->'inventory'->>'total')::bigint from t.res where k = 'apply1'), 'adedi dolu envanter satırları eklendi');
select t.eq((select count(*) from expected_items e join room_types r on r.id = e.room_type_id
             where r.code = 'X3' and e.step_id is not null) > 0, true, 'X3 kalemleri adımlara bağlandı');

-- ---------- Tekrar yükleme: kopya oluşmaz ----------
insert into t.res values ('apply2', import_master_data(:'payload'::jsonb, true));
select t.eq((select count(*) from rooms), 40::bigint, 'tekrar yükleyince oda kopyalanmaz');
select t.eq((select count(*) from check_steps), (select jsonb_array_length(:'payload'::jsonb->'steps'))::bigint, 'tekrar yükleyince adım kopyalanmaz');
select t.eq((select count(*) from expected_items),
            (select (v->'counts'->'inventory'->>'total')::bigint from t.res where k = 'apply1'), 'tekrar yükleyince envanter kopyalanmaz');
select t.eq((select (v->'counts'->'rooms'->>'new')::int from t.res where k = 'apply2'), 0, 'ikinci yüklemede yeni oda sayısı 0');

-- ---------- Hatalı dosya: hiçbir şey yazılmaz ----------
insert into t.res values ('bad', import_master_data(jsonb_build_object(
  'properties', '[{"row":2,"name":"Yeni Otel","city":"Bodrum","region":"mugla"}]'::jsonb,
  'rooms', '[{"row":2,"property":"Tare Houses Hotel","room_no":"999","room_type":"YOK"},
             {"row":3,"property":"Tare Houses Hotel","room_no":"998","room_type":"EDR"}]'::jsonb,
  'steps', '[{"row":2,"room_type":"X1","step_order":1,"title":"A","instruction":"b","full":false,"stayover":false}]'::jsonb,
  'inventory', '[{"sheet":"Envanter - Demirbaş","row":2,"property":"Tare Houses Hotel","room_type":"X1","item_key":"olmayan","qty":1}]'::jsonb
), true));
select t.eq((select (v->>'applied')::boolean from t.res where k = 'bad'), false, 'hatalı dosya uygulanmaz');
select t.eq((select count(*) from jsonb_array_elements((select v->'errors' from t.res where k = 'bad'))), 5::bigint,
            'bölge, bilinmeyen oda tipi, başka otelin oda tipi, görünmeyen adım ve katalogda olmayan kalem hatası');
select t.eq((select count(*) from properties where name = 'Yeni Otel'), 0::bigint, 'hatalı dosyadan otel eklenmedi');
select t.eq((select count(*) from rooms where room_no in ('998', '999')), 0::bigint, 'hatalı dosyadan oda eklenmedi');

-- ---------- Gerçek adımlar gelince genel şablon kalkar ----------
insert into t.res values ('x1', import_master_data(jsonb_build_object('steps',
  '[{"row":2,"room_type":"X1","step_order":1,"title":"Giriş","instruction":"çek","full":true,"stayover":true},
    {"row":3,"room_type":"X1","step_order":2,"title":"Banyo","instruction":"çek","full":true,"stayover":false}]'::jsonb), true));
select t.eq((select count(*) from check_steps s join room_types r on r.id = s.room_type_id where r.code = 'X1'), 2::bigint,
            'X1 genel şablon yerine Excel adımları');
select t.eq((select count(*) from check_steps s join room_types r on r.id = s.room_type_id where r.code = 'X1' and generic), 0::bigint,
            'X1 genel şablon silindi');

reset role;
\echo 'İÇE AKTARMA TESTLERİ GEÇTİ'
