-- Telegram günlük özeti (karar 21). n8n sabah 08:00 ve akşam 20:00'de çağırır; anahtar ops.app_secrets.SUMMARY_KEY.
-- Dönüş: Telegram HTML biçiminde metin.
create or replace function daily_summary(p_key text, p_kind text default 'morning') returns text
language plpgsql stable security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Europe/Istanbul')::date;
  out text := '';
  r record;
  n int;
begin
  -- Anahtar tanımlı değilse ya da eşleşmiyorsa (NULL karşılaştırması dahil) reddet
  if not coalesce(p_key = (select value from ops.app_secrets where name = 'SUMMARY_KEY'), false) then
    raise exception 'Yetkisiz' using errcode = '42501';
  end if;

  if p_kind = 'morning' then
    out := format('🧹 <b>HK · %s · sabah</b>', to_char(d, 'DD.MM.YYYY')) || E'\n';
    for r in
      select p.name,
             count(*) filter (where ds.status in ('checkout', 'checkout_checkin')) as cikis,
             count(*) filter (where ds.status in ('checkin', 'checkout_checkin')) as giris,
             count(*) filter (where ds.status = 'stayover') as konak,
             count(*) filter (where b.id is not null) as blok
      from rooms ro join properties p on p.id = ro.property_id
      left join room_day_status ds on ds.room_id = ro.id and ds.day = d
      left join room_blocks b on b.room_id = ro.id and d between b.start_date and b.end_date
      where ro.active group by p.name order by p.name
    loop
      out := out || format(E'\n<b>%s</b>: %s çıkış · %s giriş · %s konaklama%s', r.name, r.cikis, r.giris, r.konak,
                           case when r.blok > 0 then format(' · %s kullanım dışı', r.blok) else '' end);
    end loop;
    select count(*) into n from damage_reports where status <> 'resolved';
    out := out || E'\n\n' || format('🔧 Açık hasar: %s', n);
    select count(*) into n from inventory_issues where status = 'open';
    out := out || format(' · 📦 Açık eksik: %s', n);
    select count(*) into n from cleanings where status = 'submitted';
    out := out || format(' · ⏳ Onay bekleyen: %s', n);
    return out;
  end if;

  -- Akşam: bugün kim ne yaptı
  out := format('🧹 <b>HK · %s · gün sonu</b>', to_char(d, 'DD.MM.YYYY')) || E'\n';
  for r in
    select pr.full_name, count(*) as oda,
           count(*) filter (where c.type = 'stayover') as konak,
           round(avg(extract(epoch from c.finished_at - c.started_at) / 60)) as dk,
           count(*) filter (where c.ai_overall in ('warn', 'fail', 'unclear')) as sorun
    from cleanings c join profiles pr on pr.id = c.hk_id
    where c.day = d and c.status in ('submitted', 'analyzing', 'approved', 'escalated')
    group by pr.full_name order by 2 desc
  loop
    out := out || format(E'\n• %s: %s oda (%s konaklama) · ort. %s dk%s', r.full_name, r.oda, r.konak, coalesce(r.dk::text, '?'),
                         case when r.sorun > 0 then format(' · AI uyarısı %s', r.sorun) else '' end);
  end loop;
  if not found then out := out || E'\nBugün gönderilmiş temizlik yok.'; end if;
  select count(*) into n from rooms ro
    join lateral room_hk_state(ro.id, now()) s on true where ro.active and s.hk_state = 'dirty' and not coalesce(s.occupied, false);
  out := out || E'\n\n' || format('🔴 Şu an temizlenecek boş oda: %s', n);
  select count(*) into n from cleanings where status = 'submitted';
  out := out || format(E'\n⏳ Onay bekleyen: %s', n);
  select count(*) into n from damage_reports where (created_at at time zone 'Europe/Istanbul')::date = d;
  out := out || format(E'\n🔧 Bugün bildirilen hasar: %s', n);
  select count(*) into n from lost_items where (found_at at time zone 'Europe/Istanbul')::date = d;
  out := out || format(' · 🎒 Bulunan eşya: %s', n);
  select count(*) into n from ai_usage where (created_at at time zone 'Europe/Istanbul')::date = d;
  out := out || format(E'\n🤖 AI kontrolü: %s fotoğraf', n);
  return out;
end $$;
revoke execute on function daily_summary(text, text) from public;
grant execute on function daily_summary(text, text) to anon, authenticated;
