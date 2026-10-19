-- AI fotoğraf kontrolü (karar 18). Her yüklenen adım fotoğrafı `analyze-step` Edge Function'ıyla
-- kontrol maddelerine ve oda tipinin referans fotoğrafına göre değerlendirilir. HK sonucu çekim ekranında görür.
-- İlk haftalar onay yine süpervizörde (manual_approval_required = true); AI sonucu ona yardımcıdır.

update settings set value = 'true' where key = 'manual_approval_required';

-- Fotoğraf kaydı düşünce kuyruğa girer. İstemci hemen analiz ister; kaçan olursa dakikalık tarama işler.
create or replace function _enqueue_ai() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.media_key is not null and not new.skipped then
    insert into ai_queue (step_result_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger step_results_ai after insert on step_results for each row execute function _enqueue_ai();
revoke execute on function _enqueue_ai() from anon, public, authenticated;

-- Kaydın genel AI sonucu: her adım/karenin son denemesine göre en kötüsü
create or replace function refresh_cleaning_ai(p_cleaning uuid) returns ai_status
language sql volatile security definer set search_path = public as $$
  with latest as (
    select distinct on (step_id, shot) ai_status, ai_false_alarm, skipped
    from step_results where cleaning_id = p_cleaning
    order by step_id, shot, attempt desc
  ), s as (
    select case
      when bool_or(ai_status = 'fail' and not ai_false_alarm) then 'fail'
      when bool_or(ai_status = 'pending' and not skipped) then 'pending'
      when bool_or(ai_status = 'unclear' and not ai_false_alarm) then 'unclear'
      when bool_or(ai_status = 'warn' and not ai_false_alarm) then 'warn'
      else 'ok' end::ai_status as v
    from latest
  )
  update cleanings set ai_overall = coalesce(s.v, 'pending') from s where id = p_cleaning returning ai_overall
$$;
revoke execute on function refresh_cleaning_ai(uuid) from anon, public;
revoke execute on function refresh_cleaning_ai(uuid) from authenticated;
grant execute on function refresh_cleaning_ai(uuid) to service_role;

-- Süpervizör "yanlış alarm" işaretleyince kaydın genel sonucu da güncellensin
create or replace function _ai_false_alarm_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform refresh_cleaning_ai(new.cleaning_id);
  return new;
end $$;
create trigger step_results_false_alarm after update of ai_false_alarm on step_results
  for each row execute function _ai_false_alarm_changed();
revoke execute on function _ai_false_alarm_changed() from anon, public, authenticated;

-- Dakikalık tarama: kuyrukta kalan fotoğraflar (HK çevrimdışıyken yüklenenler, hata alanlar)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ai-sweep', '* * * * *', $job$
      select net.http_post(
        url := 'https://ihwyfllcvkcpjsouhsel.supabase.co/functions/v1/analyze-step',
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-cron-key', (select key from ops.cron_key)),
        body := '{"trigger":"cron"}'::jsonb)
      where exists (select 1 from public.ai_queue where tries < 3)
    $job$);
  end if;
end $$;
