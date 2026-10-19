-- Excel'den temel veri içe aktarma (spec 3, kararlar 6, 11, 12, 13).
-- * Excel'deki ek alanlar: otel kilit türü/not, oda tipi PMS kodu/dış alan/max süre.
-- * item_catalog: tesis bazında kalem kataloğu. Envanter oda tipine bağlanır, adım bağlantısı isteğe bağlı.
-- * import_master_data(): önce doğrular (hata ve uyarı listesi), istenirse tek işlemde uygular.
--   Tekrar yüklenince günceller, kopya oluşturmaz.

-- ---------- Yeni alanlar ----------
alter table properties
  add column lock_type text,
  add column note      text;

alter table room_types
  add column pms_code             text,
  add column outdoor              text,
  add column max_minutes_full     int,
  add column max_minutes_stayover int,
  add column max_enabled          boolean not null default false;   -- açıksa süre aşımı panoda kırmızı

-- Excel'de adımı olmayan oda tipleri için geçici genel şablon (karar 6); gerçek adımlar gelince silinir
alter table check_steps add column generic boolean not null default false;

-- ---------- Kalem kataloğu ----------
create table item_catalog (
  id           uuid primary key default gen_random_uuid(),
  property_id  uuid not null references properties(id) on delete cascade,
  item_key     text not null,
  label        text not null,
  kind         text,                 -- Demirbaş, Mutfak Malzemesi, Sarf, İkram, İçecek
  description  text,                 -- ayırt edici tarif
  photo_file   text,                 -- Excel'deki dosya adı
  photo_key    text,                 -- R2 (admin ekranından yüklenir)
  unique (property_id, item_key)
);
alter table item_catalog enable row level security;
create policy admin_all on item_catalog for all using (is_admin()) with check (is_admin());
create policy read_catalog on item_catalog for select using (auth.uid() is not null);

-- ---------- Envanter oda tipine bağlanır ----------
alter table expected_items
  add column room_type_id uuid references room_types(id) on delete cascade,
  add column catalog_id   uuid references item_catalog(id) on delete set null,
  add column location     text,      -- İkram: minibar, ikram tepsisi
  add column note         text;
update expected_items e set room_type_id = s.room_type_id from check_steps s where s.id = e.step_id;
alter table expected_items
  alter column room_type_id set not null,
  alter column step_id drop not null,
  drop constraint expected_items_step_id_item_key_key,
  drop constraint expected_items_step_id_fkey,
  add constraint expected_items_step_id_fkey foreign key (step_id) references check_steps(id) on delete set null,
  add constraint expected_items_room_type_item unique (room_type_id, item_key);

-- ---------- İçe aktarma ----------
-- p: arayüzün Excel'den okuyup sadeleştirdiği veri (src/lib/excelImport.ts). Her satırda Excel satır no (row).
-- Dönüş: {errors:[{sheet,row,message}], warnings:[...], counts:{...}, applied:bool}
-- Hata varsa hiçbir şey yazılmaz.
create or replace function import_master_data(p jsonb, p_apply boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  errs  jsonb := '[]';
  warns jsonb := '[]';
  counts jsonb := '{}';
  r record;
begin
  if not is_admin() then raise exception 'Bu işlem için admin yetkisi gerekir' using errcode = '42501'; end if;

  -- Gelen veri geçici tablolara
  perform set_config('client_min_messages', 'warning', true);
  drop table if exists _p, _rt, _rm, _st, _ct, _iv, _known_p, _known_rt;
  create temp table _p on commit drop as
    select * from jsonb_to_recordset(coalesce(p->'properties', '[]')) as x(
      "row" int, name text, city text, region text, district text, floors int, pms_name text, lock_type text, note text);
  create temp table _rt on commit drop as
    select * from jsonb_to_recordset(coalesce(p->'room_types', '[]')) as x(
      "row" int, code text, name text, property text, pms_code text, approx_m2 numeric, bed_type text, max_guests int,
      has_kitchen boolean, bath_type text, outdoor text, min_full int, min_stay int, max_full int, max_stay int,
      max_enabled boolean, note text);
  create temp table _rm on commit drop as
    select * from jsonb_to_recordset(coalesce(p->'rooms', '[]')) as x(
      "row" int, property text, room_no text, floor int, room_type text, active boolean, note text);
  create temp table _st on commit drop as
    select * from jsonb_to_recordset(coalesce(p->'steps', '[]')) as x(
      "row" int, room_type text, step_order int, zone text, title text, instruction text, checks text[],
      "full" boolean, stayover boolean, needs_flash boolean, required boolean, shots int, ai_prompt text);
  create temp table _ct on commit drop as
    select * from jsonb_to_recordset(coalesce(p->'catalog', '[]')) as x(
      sheet text, "row" int, property text, item_key text, label text, kind text, description text, photo_file text);
  create temp table _iv on commit drop as
    select * from jsonb_to_recordset(coalesce(p->'inventory', '[]')) as x(
      sheet text, "row" int, property text, room_type text, step_order int, item_key text, qty int,
      verified boolean, location text, note text);

  -- Bilinen oteller/oda tipleri: Excel'dekiler + veritabanında olanlar
  create temp table _known_p on commit drop as
    select name from _p where name is not null union select name from properties;
  create temp table _known_rt on commit drop as
    select code, property from _rt where code is not null
    union all
    select t.code, pr.name from room_types t left join properties pr on pr.id = t.property_id
    where t.code not in (select code from _rt where code is not null);

  -- ---------- Doğrulama ----------
  -- Oteller
  for r in select "row", 'Otel adı boş' m from _p where coalesce(name, '') = ''
     union all select "row", 'Bölge İstanbul veya İzmir olmalı' from _p where region is null or region not in ('istanbul', 'izmir')
     union all select "row", 'Şehir boş' from _p where coalesce(city, '') = ''
     union all select max("row"), format('"%s" iki kez yazılmış', name) from _p where name is not null group by name having count(*) > 1
  loop errs := errs || jsonb_build_object('sheet', 'Oteller', 'row', r."row", 'message', r.m); end loop;

  -- Oda tipleri
  for r in select "row", 'Oda tipi adı boş' m from _rt where coalesce(name, '') = ''
     union all select "row", format('Bilinmeyen otel: "%s"', property) from _rt where property is null or property not in (select name from _known_p)
     union all select max("row"), format('"%s" kodu iki kez yazılmış', code) from _rt group by code having count(*) > 1
  loop errs := errs || jsonb_build_object('sheet', 'Oda Tipleri', 'row', r."row", 'message', r.m); end loop;

  -- Odalar
  for r in select "row", 'Oda no boş' m from _rm where coalesce(room_no, '') = ''
     union all select "row", format('Bilinmeyen otel: "%s"', property) from _rm where property is null or property not in (select name from _known_p)
     union all select m."row", format('Bilinmeyen oda tipi kodu: "%s"', m.room_type) from _rm m
               where not exists (select 1 from _known_rt k where k.code = m.room_type)
     union all select m."row", format('"%s" oda tipi "%s" oteline ait, oda "%s" otelinde', m.room_type, k.property, m.property)
               from _rm m join _known_rt k on k.code = m.room_type where k.property is distinct from m.property
     union all select max("row"), format('%s otelinde %s numaralı oda iki kez yazılmış', property, room_no)
               from _rm where room_no is not null group by property, room_no having count(*) > 1
  loop errs := errs || jsonb_build_object('sheet', 'Odalar', 'row', r."row", 'message', r.m); end loop;

  -- Kontrol adımları
  for r in select s."row", format('Bilinmeyen oda tipi kodu: "%s"', s.room_type) m from _st s
               where not exists (select 1 from _known_rt k where k.code = s.room_type)
     union all select "row", 'Sıra boş' from _st where step_order is null
     union all select "row", 'Adım adı boş' from _st where coalesce(title, '') = ''
     union all select "row", 'Çekim talimatı boş' from _st where coalesce(instruction, '') = ''
     union all select "row", 'Çıkışta ve Konaklamada ikisi de Hayır; adım hiçbir kontrolde görünmez'
               from _st where not coalesce("full", false) and not coalesce(stayover, false)
     union all select "row", 'Kare sayısı 1–5 arası olmalı' from _st where shots is not null and shots not between 1 and 5
     union all select max("row"), format('%s için %s. adım iki kez yazılmış', room_type, step_order)
               from _st where step_order is not null group by room_type, step_order having count(*) > 1
  loop errs := errs || jsonb_build_object('sheet', 'Kontrol Adımları', 'row', r."row", 'message', r.m); end loop;

  -- Kalem kataloğu
  for r in select sheet, "row", format('Bilinmeyen tesis: "%s"', property) m from _ct
               where property is null or property not in (select name from _known_p)
     union all select sheet, "row", 'Kalem kodu boş' from _ct where coalesce(item_key, '') = ''
     union all select sheet, "row", 'Kalem adı boş' from _ct where coalesce(label, '') = ''
     union all select min(sheet), max("row"), format('%s için "%s" kalem kodu iki kez yazılmış', property, item_key)
               from _ct where item_key is not null group by property, item_key having count(*) > 1
  loop errs := errs || jsonb_build_object('sheet', r.sheet, 'row', r."row", 'message', r.m); end loop;

  -- Envanter
  for r in select i.sheet, i."row", format('Bilinmeyen oda tipi kodu: "%s"', i.room_type) m from _iv i
               where not exists (select 1 from _known_rt k where k.code = i.room_type)
     union all select i.sheet, i."row", format('"%s" oda tipi "%s" tesisine ait, satırda "%s" yazıyor', i.room_type, k.property, i.property)
               from _iv i join _known_rt k on k.code = i.room_type where k.property is distinct from i.property
     union all select i.sheet, i."row", format('"%s" kalemi %s kataloğunda yok', i.item_key, i.property) from _iv i
               where not exists (select 1 from _ct c where c.property = i.property and c.item_key = i.item_key)
                 and not exists (select 1 from item_catalog c join properties pr on pr.id = c.property_id
                                 where pr.name = i.property and c.item_key = i.item_key)
     union all select sheet, "row", 'Adet negatif olamaz' from _iv where qty < 0
     union all select min(sheet), max("row"), format('%s oda tipinde "%s" kalemi iki kez yazılmış', room_type, item_key)
               from _iv group by room_type, item_key having count(*) > 1
  loop errs := errs || jsonb_build_object('sheet', r.sheet, 'row', r."row", 'message', r.m); end loop;

  -- ---------- Uyarılar ----------
  for r in select sheet, "row", 'Adet boş; satır atlandı' m from _iv where qty is null
     union all select i.sheet, i."row", format('%s oda tipinde %s. adım yok; kalem adıma bağlanmadan eklenecek', i.room_type, i.step_order)
               from _iv i where i.step_order is not null and i.qty is not null
                 and not exists (select 1 from _st s where s.room_type = i.room_type and s.step_order = i.step_order)
                 and not exists (select 1 from check_steps s join room_types t on t.id = s.room_type_id
                                 where t.code = i.room_type and s.step_order = i.step_order and not s.generic)
  loop warns := warns || jsonb_build_object('sheet', r.sheet, 'row', r."row", 'message', r.m); end loop;

  for r in select count(*) n, string_agg(k.code, ', ' order by k.code) codes from _known_rt k
            where not exists (select 1 from _st s where s.room_type = k.code)
              and not exists (select 1 from check_steps s join room_types t on t.id = s.room_type_id
                              where t.code = k.code and not s.generic)
            having count(*) > 0
  loop warns := warns || jsonb_build_object('sheet', 'Kontrol Adımları', 'row', null,
         'message', format('%s oda tipinin adımı yok (%s); geçici 5 adımlık genel şablon kullanılacak', r.n, r.codes));
  end loop;

  counts := jsonb_build_object(
    'properties', jsonb_build_object('total', (select count(*) from _p),
                                     'new', (select count(*) from _p where name not in (select name from properties))),
    'room_types', jsonb_build_object('total', (select count(*) from _rt),
                                     'new', (select count(*) from _rt where code not in (select code from room_types))),
    'rooms',      jsonb_build_object('total', (select count(*) from _rm),
                                     'new', (select count(*) from _rm m where not exists (
                                        select 1 from rooms ro join properties pr on pr.id = ro.property_id
                                        where pr.name = m.property and ro.room_no = m.room_no))),
    'steps',      jsonb_build_object('total', (select count(*) from _st)),
    'catalog',    jsonb_build_object('total', (select count(*) from _ct)),
    'inventory',  jsonb_build_object('total', (select count(*) from _iv where qty is not null),
                                     'skipped', (select count(*) from _iv where qty is null),
                                     'unverified', (select count(*) from _iv where qty is not null and not coalesce(verified, false))));

  if jsonb_array_length(errs) > 0 or not p_apply then
    return jsonb_build_object('errors', errs, 'warnings', warns, 'counts', counts, 'applied', false);
  end if;

  -- ---------- Uygulama ----------
  insert into properties (name, city, region, district, floors, pms_name, lock_type, note)
  select name, city, region::region, district, floors, pms_name, lock_type, note from _p
  on conflict (name) do update set city = excluded.city, region = excluded.region, district = excluded.district,
    floors = excluded.floors, pms_name = excluded.pms_name, lock_type = excluded.lock_type, note = excluded.note;

  insert into room_types (code, name, property_id, pms_code, approx_m2, bed_type, max_guests, has_kitchen, bath_type,
                          outdoor, min_minutes_full, min_minutes_stayover, max_minutes_full, max_minutes_stayover,
                          max_enabled, note)
  select t.code, t.name, pr.id, t.pms_code, t.approx_m2, t.bed_type, t.max_guests, t.has_kitchen, t.bath_type, t.outdoor,
         coalesce(t.min_full, 25), coalesce(t.min_stay, 10), t.max_full, t.max_stay, coalesce(t.max_enabled, false), t.note
  from _rt t join properties pr on pr.name = t.property
  on conflict (code) do update set name = excluded.name, property_id = excluded.property_id, pms_code = excluded.pms_code,
    approx_m2 = excluded.approx_m2, bed_type = excluded.bed_type, max_guests = excluded.max_guests,
    has_kitchen = excluded.has_kitchen, bath_type = excluded.bath_type, outdoor = excluded.outdoor,
    min_minutes_full = excluded.min_minutes_full, min_minutes_stayover = excluded.min_minutes_stayover,
    max_minutes_full = excluded.max_minutes_full, max_minutes_stayover = excluded.max_minutes_stayover,
    max_enabled = excluded.max_enabled, note = excluded.note;

  insert into rooms (property_id, room_type_id, room_no, floor, active, note)
  select pr.id, t.id, m.room_no, m.floor, coalesce(m.active, true), m.note
  from _rm m join properties pr on pr.name = m.property join room_types t on t.code = m.room_type
  on conflict (property_id, room_no) do update set room_type_id = excluded.room_type_id, floor = excluded.floor,
    active = excluded.active, note = excluded.note;

  -- Adımlar: Excel'de adımı olan oda tiplerinde Excel'de olmayan adımlar (genel şablon dahil) silinir;
  -- fotoğrafı olan adım silinmez, uyarı verilir.
  for r in select t.code, s.step_order from check_steps s join room_types t on t.id = s.room_type_id
            where t.code in (select room_type from _st)
              and not exists (select 1 from _st x where x.room_type = t.code and x.step_order = s.step_order)
              and exists (select 1 from step_results sr where sr.step_id = s.id)
  loop warns := warns || jsonb_build_object('sheet', 'Kontrol Adımları', 'row', null,
         'message', format('%s oda tipinin %s. adımı Excel''de yok ama fotoğrafı olduğu için silinmedi', r.code, r.step_order));
  end loop;
  delete from check_steps s using room_types t
   where t.id = s.room_type_id and t.code in (select room_type from _st)
     and not exists (select 1 from _st x where x.room_type = t.code and x.step_order = s.step_order)
     and not exists (select 1 from step_results sr where sr.step_id = s.id);

  insert into check_steps (room_type_id, step_order, zone, title, instruction, checks, ai_prompt, applies_to,
                           required, needs_flash, shots, generic)
  select t.id, s.step_order, coalesce(s.zone, ''), s.title, s.instruction, coalesce(s.checks, '{}'), s.ai_prompt,
         array_remove(array[case when s."full" then 'full' end, case when s.stayover then 'stayover' end], null)::cleaning_type[],
         coalesce(s.required, true), coalesce(s.needs_flash, false), coalesce(s.shots, 1), false
  from _st s join room_types t on t.code = s.room_type
  on conflict (room_type_id, step_order) do update set zone = excluded.zone, title = excluded.title,
    instruction = excluded.instruction, checks = excluded.checks, ai_prompt = excluded.ai_prompt,
    applies_to = excluded.applies_to, required = excluded.required, needs_flash = excluded.needs_flash,
    shots = excluded.shots, generic = false;

  -- Adımı hiç olmayan oda tiplerine genel şablon (karar 6)
  insert into check_steps (room_type_id, step_order, zone, title, instruction, checks, applies_to, generic)
  select t.id, g.step_order, g.zone, g.title, g.instruction, g.checks, '{full,stayover}', true
  from room_types t
  cross join (values
    (1, 'Giriş', 'Giriş',     'Kapıdan girip girişi tek karede çek. Işıklar açık olsun.',
        array['Zemin temiz, leke ve saç yok', 'Aydınlatma yanıyor']),
    (2, 'Banyo', 'Banyo',     'Lavabo, ayna ve duş aynı karede olacak şekilde çek.',
        array['Lavabo ve batarya temiz', 'Ayna lekesiz', 'Duş temiz, giderde saç yok', 'Havlular tam ve katlı']),
    (3, 'Banyo', 'WC',        'Klozet kapağı açık, tuvalet kağıdı ve yedek rulo görünecek şekilde çek.',
        array['Klozet temiz', 'Tuvalet kağıdı takılı + yedek rulo', 'Çöp kovası boş']),
    (4, 'Oda',   'Yatak',     'Yatağı ayak ucundan, tamamı görünecek şekilde çek.',
        array['Çarşaf gergin, kenarlar düzgün', 'Yastıklar düzgün']),
    (5, 'Oda',   'Genel oda', 'Kapı tarafından tüm odayı tek geniş karede çek. Tüm ışıklar açık.',
        array['Zemin temiz', 'Çöp kovası boş', 'Açıkta kablo yok'])
  ) as g(step_order, zone, title, instruction, checks)
  where not exists (select 1 from check_steps s where s.room_type_id = t.id);

  -- Katalog
  insert into item_catalog (property_id, item_key, label, kind, description, photo_file)
  select pr.id, c.item_key, c.label, c.kind, c.description, c.photo_file
  from _ct c join properties pr on pr.name = c.property
  on conflict (property_id, item_key) do update set label = excluded.label, kind = excluded.kind,
    description = excluded.description, photo_file = excluded.photo_file;

  -- Envanter: Excel'de envanteri olan oda tiplerinde Excel'de olmayan kalemler silinir (açık eksik kaydı olan kalmaz)
  delete from expected_items e using room_types t
   where t.id = e.room_type_id and t.code in (select room_type from _iv where qty is not null)
     and not exists (select 1 from _iv x where x.room_type = t.code and x.item_key = e.item_key and x.qty is not null)
     and not exists (select 1 from inventory_issues ii where ii.expected_item_id = e.id);

  insert into expected_items (room_type_id, step_id, catalog_id, item_key, label, qty, verified, location, note)
  select t.id, s.id, c.id, i.item_key, c.label, i.qty, coalesce(i.verified, false), i.location, i.note
  from _iv i
  join room_types t on t.code = i.room_type
  join item_catalog c on c.property_id = t.property_id and c.item_key = i.item_key
  left join check_steps s on s.room_type_id = t.id and s.step_order = i.step_order and not s.generic
  where i.qty is not null
  on conflict (room_type_id, item_key) do update set step_id = excluded.step_id, catalog_id = excluded.catalog_id,
    label = excluded.label, qty = excluded.qty, verified = excluded.verified, location = excluded.location,
    note = excluded.note;

  return jsonb_build_object('errors', errs, 'warnings', warns, 'counts', counts, 'applied', true);
end $$;

revoke execute on function import_master_data(jsonb, boolean) from anon, public;
grant execute on function import_master_data(jsonb, boolean) to authenticated;
