-- Hasar bildirimi ve kayıp eşya (spec 5.5, 5.6) + uygulama içi bildirim (spec 6).
-- Tablolar 0001'de; burada: istemcinin ürettiği kimlikle tekrar gönderilebilir kayıt (çevrimdışı kuyruk),
-- süpervizör/admin'e bildirim, durum değişikliğinde kim/ne zaman.

-- Yeni hasar/eşya: bölge süpervizörlerine ve tüm adminlere bildirim
create or replace function _notify_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  room text; prop text; reg region; kind text; title text; link text;
begin
  select r.room_no, p.name, p.region into room, prop, reg from rooms r join properties p on p.id = r.property_id where r.id = new.room_id;
  if tg_table_name = 'damage_reports' then
    kind := 'damage'; title := format('Hasar: %s %s · %s', prop, room, new.category); link := '#/kayitlar/hasar/' || new.id;
  else
    kind := 'lost_item'; title := format('Eşya bulundu: %s %s', prop, room); link := '#/kayitlar/esya/' || new.id;
  end if;
  insert into notifications (user_id, kind, title, body, link)
  select pr.id, kind, title, left(new.description, 200), link
  from profiles pr
  where pr.active and (pr.role = 'admin' or (pr.role = 'supervisor' and pr.region = reg));
  return new;
end $$;
create trigger damage_notify after insert on damage_reports for each row execute function _notify_report();
create trigger lost_notify after insert on lost_items for each row execute function _notify_report();
revoke execute on function _notify_report() from anon, public, authenticated;

-- Durum değişince kimin ne zaman kapattığı sunucuda yazılır
create or replace function _stamp_damage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' then
    new.resolved_at := now(); new.resolved_by := auth.uid();
  elsif new.status <> 'resolved' then
    new.resolved_at := null; new.resolved_by := null;
  end if;
  return new;
end $$;
create trigger damage_stamp before update on damage_reports for each row execute function _stamp_damage();

create or replace function _stamp_lost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'stored' and old.status = 'stored' then
    new.closed_at := now(); new.closed_by := auth.uid();
  elsif new.status = 'stored' then
    new.closed_at := null; new.closed_by := null;
  end if;
  return new;
end $$;
create trigger lost_stamp before update on lost_items for each row execute function _stamp_lost();
revoke execute on function _stamp_damage(), _stamp_lost() from anon, public, authenticated;

-- Kategori listesi sabit (spec 5.5)
alter table damage_reports add constraint damage_category check
  (category in ('Mobilya', 'Elektrik', 'Tesisat', 'Boya/duvar', 'Cihaz', 'Tekstil', 'Diğer'));

-- Kayıp eşya araması için
create index on lost_items (found_at desc);
create index on damage_reports (created_at desc);

-- Aynı fotoğraf kuyruktan iki kez gönderilirse ikinci kayıt oluşmasın
create unique index report_media_key on report_media (media_key);
