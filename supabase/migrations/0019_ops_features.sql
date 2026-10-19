-- Karar 21: saklama süresi, otomatik onay ayarı, süre uyarısı, AI demirbaş sayımı, telefon bildirimi, AI istatistikleri.

-- ---------- Ayarlar ----------
insert into settings (key, value) values
  ('ai_price_input_per_mtok', '0.10'),   -- Claude Haiku 5.5, $ / 1M girdi token
  ('ai_price_output_per_mtok', '0.50')
on conflict (key) do nothing;

alter table ops.app_secrets drop constraint app_secrets_name_check;
alter table ops.app_secrets add constraint app_secrets_name_check
  check (name in ('ANTHROPIC_API_KEY', 'CLAUDE_MODEL', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'SUMMARY_KEY'));

-- ---------- Saklama (spec 8): süresi dolan medya ----------
-- Temizlik fotoğrafı media_retention_days (15) gün; şikayetli kayıt silinmez. Hasar kapandıktan 90, kayıp eşya 365 gün.
-- Referanslar (ref/...) ayrı kopya olduğu için etkilenmez. `retention` Edge Function'ı R2'den siler, sonra işaretler.
create or replace function media_to_delete(p_limit int default 500)
returns table (kind text, id uuid, media_key text)
language sql stable security definer set search_path = public as $$
  with s as (
    select (select value::text::int from settings where key = 'media_retention_days') as clean_days,
           (select value::text::int from settings where key = 'damage_media_retention_days_after_close') as damage_days,
           (select value::text::int from settings where key = 'lost_media_retention_days_after_close') as lost_days
  )
  (select 'step'::text, r.id, r.media_key from step_results r join cleanings c on c.id = r.cleaning_id, s
   where r.media_key is not null and r.media_deleted_at is null and not c.complaint
     and coalesce(r.captured_at, c.started_at) < now() - make_interval(days => s.clean_days)
   limit p_limit)
  union all
  (select 'report', m.id, m.media_key from report_media m join damage_reports d on d.id = m.damage_id, s
   where m.media_deleted_at is null and d.status = 'resolved' and d.resolved_at < now() - make_interval(days => s.damage_days)
   limit p_limit)
  union all
  (select 'report', m.id, m.media_key from report_media m join lost_items l on l.id = m.lost_id, s
   where m.media_deleted_at is null and l.status <> 'stored' and l.closed_at < now() - make_interval(days => s.lost_days)
   limit p_limit)
$$;
revoke execute on function media_to_delete(int) from anon, public, authenticated;
grant execute on function media_to_delete(int) to service_role;

-- ---------- Otomatik onay (ayar: manual_approval_required = false) ----------
-- Gönderilmiş kayıtta tüm adımlar AI'dan "ok" geçerse kendiliğinden onaylanır.
create or replace function refresh_cleaning_ai(p_cleaning uuid) returns ai_status
language plpgsql volatile security definer set search_path = public as $$
declare v ai_status;
begin
  with latest as (
    select distinct on (step_id, shot) ai_status, ai_false_alarm, skipped
    from step_results where cleaning_id = p_cleaning
    order by step_id, shot, attempt desc
  )
  select case
      when bool_or(ai_status = 'fail' and not ai_false_alarm) then 'fail'
      when bool_or(ai_status = 'pending' and not skipped) then 'pending'
      when bool_or(ai_status = 'unclear' and not ai_false_alarm) then 'unclear'
      when bool_or(ai_status = 'warn' and not ai_false_alarm) then 'warn'
      else 'ok' end::ai_status
    into v from latest;
  v := coalesce(v, 'pending');
  update cleanings set ai_overall = v where id = p_cleaning;
  if v = 'ok' and (select value::text from settings where key = 'manual_approval_required') = 'false' then
    update cleanings set status = 'approved', approved_by_ai = true, reviewed_at = now(),
                         review_note = coalesce(review_note, 'AI onayı: tüm adımlar geçti')
    where id = p_cleaning and status = 'submitted';
  end if;
  return v;
end $$;
revoke execute on function refresh_cleaning_ai(uuid) from anon, public, authenticated;
grant execute on function refresh_cleaning_ai(uuid) to service_role;

-- AI sonuçları gönderimden önce tamamlandıysa: gönderilince otomatik onay yine değerlendirilsin
create or replace function _cleaning_submitted() returns trigger
language plpgsql security definer set search_path = public as $$
declare room text; prop text; reg region;
begin
  perform refresh_cleaning_ai(new.id);
  -- Bölge süpervizörlerine "onay bekliyor" bildirimi (otomatik onaylanmadıysa)
  if (select status from cleanings where id = new.id) = 'submitted' then
    select r.room_no, p.name, p.region into room, prop, reg from rooms r join properties p on p.id = r.property_id where r.id = new.room_id;
    insert into notifications (user_id, kind, title, body, link)
    select pr.id, 'review', format('Onay bekliyor: %s %s', prop, room),
           (select full_name from profiles where id = new.hk_id), '#/kayit/' || new.id
    from profiles pr where pr.active and pr.role = 'supervisor' and pr.region = reg;
  end if;
  return new;
end $$;
create trigger cleaning_submitted after update of status on cleanings
  for each row when (new.status = 'submitted' and old.status is distinct from 'submitted')
  execute function _cleaning_submitted();
revoke execute on function _cleaning_submitted() from anon, public, authenticated;

-- ---------- Temizlik talebi: bölgedeki HK'lara bildirim ----------
create or replace function _notify_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare room text; prop text; reg region;
begin
  select r.room_no, p.name, p.region into room, prop, reg from rooms r join properties p on p.id = r.property_id where r.id = new.room_id;
  insert into notifications (user_id, kind, title, body, link)
  select pr.id, 'cleaning_request', format('Temizlik talebi: %s %s', prop, room), new.note, '#/oda/' || new.room_id
  from profiles pr where pr.active and pr.role in ('hk', 'supervisor') and pr.region = reg and pr.id <> coalesce(new.requested_by, gen_random_uuid());
  return new;
end $$;
create trigger cleaning_request_notify after insert on cleaning_requests for each row execute function _notify_request();
revoke execute on function _notify_request() from anon, public, authenticated;

-- ---------- Telefon bildirimi: yeni bildirim push kuyruğuna ----------
create table ops.push_queue (notification_id bigint primary key references notifications(id) on delete cascade,
                             enqueued_at timestamptz not null default now());
create or replace function _enqueue_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from push_subscriptions where user_id = new.user_id) then
    insert into ops.push_queue (notification_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger notifications_push after insert on notifications for each row execute function _enqueue_push();
revoke execute on function _enqueue_push() from anon, public, authenticated;

create or replace function push_take(p_limit int default 50)
returns table (notification_id bigint, title text, body text, link text, endpoint text, keys jsonb, sub_id bigint)
language sql volatile security definer set search_path = public as $$
  with taken as (delete from ops.push_queue q where q.notification_id in
                   (select notification_id from ops.push_queue order by enqueued_at limit p_limit) returning q.notification_id)
  select n.id, n.title, n.body, n.link, s.endpoint, s.keys, s.id
  from taken t join notifications n on n.id = t.notification_id join push_subscriptions s on s.user_id = n.user_id
$$;
revoke execute on function push_take(int) from anon, public, authenticated;
grant execute on function push_take(int) to service_role;

-- Tarayıcının abone olabilmesi için açık anahtar (gizli değil)
create or replace function vapid_public_key() returns text
language sql stable security definer set search_path = public as $$
  select value from ops.app_secrets where name = 'VAPID_PUBLIC_KEY' and auth.uid() is not null
$$;
revoke execute on function vapid_public_key() from anon, public;
grant execute on function vapid_public_key() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('push-send', '* * * * *', $job$
      select net.http_post(
        url := 'https://ihwyfllcvkcpjsouhsel.supabase.co/functions/v1/push-send',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select key from ops.cron_key)),
        body := '{}'::jsonb)
      where exists (select 1 from ops.push_queue)
    $job$);
    -- Her gece 03:30 (İstanbul = UTC+3 → 00:30 UTC) süresi dolan medyayı sil
    perform cron.schedule('retention', '30 0 * * *', $job$
      select net.http_post(
        url := 'https://ihwyfllcvkcpjsouhsel.supabase.co/functions/v1/retention',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select key from ops.cron_key)),
        body := '{}'::jsonb)
    $job$);
  end if;
end $$;

-- ---------- AI demirbaş sayımı (spec 5.3) ----------
-- analyze-step, adımdaki beklenen kalemleri sayar; eksikse "açık eksik" açılır, sonraki kontrolde tamsa kendiliğinden kapanır.
create or replace function apply_inventory(p_step_result uuid, p_counts jsonb) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  c cleanings; n int := 0; it record; seen int;
begin
  select cl.* into c from step_results r join cleanings cl on cl.id = r.cleaning_id where r.id = p_step_result;
  if c.id is null or c.type <> 'full' then return 0; end if;
  for it in select e.id, e.item_key, e.qty from step_results r join expected_items e on e.step_id = r.step_id
            where r.id = p_step_result and e.qty > 0 loop
    seen := (select (x->>'seen')::int from jsonb_array_elements(p_counts) x where x->>'key' = it.item_key and x->>'seen' is not null limit 1);
    continue when seen is null;
    if seen < it.qty then
      insert into inventory_issues (room_id, expected_item_id, expected_qty, observed_qty, opened_cleaning_id)
      values (c.room_id, it.id, it.qty, seen, c.id)
      on conflict (room_id, expected_item_id) where status = 'open'
      do update set observed_qty = excluded.observed_qty, last_seen_at = now();
      n := n + 1;
    else
      update inventory_issues set status = 'resolved', resolved_at = now(), resolved_cleaning_id = c.id, observed_qty = seen
      where room_id = c.room_id and expected_item_id = it.id and status = 'open';
    end if;
  end loop;
  return n;
end $$;
revoke execute on function apply_inventory(uuid, jsonb) from anon, public, authenticated;
grant execute on function apply_inventory(uuid, jsonb) to service_role;

-- Yeni açılan eksik: süpervizöre bildirim
create or replace function _notify_issue() returns trigger
language plpgsql security definer set search_path = public as $$
declare room text; prop text; reg region; label text;
begin
  select r.room_no, p.name, p.region into room, prop, reg from rooms r join properties p on p.id = r.property_id where r.id = new.room_id;
  select e.label into label from expected_items e where e.id = new.expected_item_id;
  insert into notifications (user_id, kind, title, body, link)
  select pr.id, 'inventory_missing', format('Eksik: %s %s · %s', prop, room, label),
         format('Beklenen %s, görülen %s', new.expected_qty, new.observed_qty), '#/kayitlar/eksik'
  from profiles pr where pr.active and (pr.role = 'admin' or (pr.role = 'supervisor' and pr.region = reg));
  return new;
end $$;
create trigger inventory_issue_notify after insert on inventory_issues for each row execute function _notify_issue();
revoke execute on function _notify_issue() from anon, public, authenticated;

-- ---------- AI istatistikleri (admin) ----------
create or replace function ai_stats(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with u as (select * from ai_usage where is_admin()
               and (created_at at time zone 'Europe/Istanbul')::date between p_from and p_to),
       r as (select sr.*, s.title, s.step_order, t.code from step_results sr
             join cleanings c on c.id = sr.cleaning_id
             join check_steps s on s.id = sr.step_id join room_types t on t.id = s.room_type_id
             where is_admin() and sr.ai_status <> 'pending' and not sr.skipped
               and (c.started_at at time zone 'Europe/Istanbul')::date between p_from and p_to)
  select jsonb_build_object(
    'photos', (select count(*) from u),
    'input_tokens', (select coalesce(sum(input_tokens), 0) from u),
    'output_tokens', (select coalesce(sum(output_tokens), 0) from u),
    'cost_usd', (select round(coalesce(sum(input_tokens), 0) / 1e6 * (select value::text::numeric from settings where key = 'ai_price_input_per_mtok')
                       + coalesce(sum(output_tokens), 0) / 1e6 * (select value::text::numeric from settings where key = 'ai_price_output_per_mtok'), 2) from u),
    'by_status', (select coalesce(jsonb_object_agg(ai_status, n), '{}') from (select ai_status, count(*) n from r group by 1) x),
    'flagged', (select count(*) from r where ai_status in ('warn', 'fail', 'unclear')),
    'false_alarms', (select count(*) from r where ai_false_alarm),
    'retakes', (select count(*) from r where attempt > 1),
    'top_steps', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
                   select code || ' · ' || step_order || '. ' || title as step, count(*) n from r
                   where ai_status in ('warn', 'fail', 'unclear') and not ai_false_alarm group by 1 order by 2 desc limit 10) x)
  )
$$;
revoke execute on function ai_stats(date, date) from anon, public;
grant execute on function ai_stats(date, date) to authenticated;

-- ---------- Bugün ekranı: süre sınırları ----------
drop function today_board();
create function today_board() returns table (
  room_id uuid, property_id uuid, room_no text, room_type_code text, day_status day_status, day_status_source text,
  block_id uuid, block_reason text, block_until date,
  cleaning_id uuid, cleaning_status cleaning_status, cleaning_type cleaning_type,
  hk_id uuid, hk_name text, members text[], started_at timestamptz, check_started_at timestamptz,
  finished_at timestamptz,
  hk_state text, hk_state_at timestamptz, occupied boolean, departing boolean, arriving boolean,
  cleaning_requested_at timestamptz, min_minutes int, max_minutes int)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid() and active),
       today as (select (now() at time zone 'Europe/Istanbul')::date as d)
  select r.id, r.property_id, r.room_no, rt.code, ds.status, ds.source,
         b.id, b.reason, b.end_date,
         c.id, c.status, c.type, c.hk_id, hp.full_name,
         (select array_agg(p.full_name order by p.full_name) from cleaning_members m join profiles p on p.id = m.profile_id
          where m.cleaning_id = c.id),
         c.started_at, c.check_started_at, c.finished_at,
         hs.hk_state, hs.hk_state_at, hs.occupied, hs.departing, hs.arriving, rq.at,
         case when coalesce(c.type, case when ds.status = 'stayover' then 'stayover' else 'full' end::cleaning_type) = 'stayover'
              then rt.min_minutes_stayover else rt.min_minutes_full end,
         case when not rt.max_enabled then null
              when coalesce(c.type, case when ds.status = 'stayover' then 'stayover' else 'full' end::cleaning_type) = 'stayover'
              then rt.max_minutes_stayover else rt.max_minutes_full end
  from me, today
  join rooms r       on r.active
  join properties pr on pr.id = r.property_id
  join room_types rt on rt.id = r.room_type_id
  left join room_day_status ds on ds.room_id = r.id and ds.day = today.d
  left join lateral (select * from room_blocks b where b.room_id = r.id and today.d between b.start_date and b.end_date
                     order by b.created_at desc limit 1) b on true
  left join lateral (select * from cleanings c where c.room_id = r.id and c.day = today.d and c.status <> 'cancelled'
                     order by c.started_at desc limit 1) c on true
  left join profiles hp on hp.id = c.hk_id
  left join lateral room_hk_state(r.id, now()) hs on true
  left join lateral (select max(q.requested_at) as at from cleaning_requests q
                     where q.room_id = r.id and (q.requested_at at time zone 'Europe/Istanbul')::date = today.d
                       and q.requested_at > coalesce((select max(x.finished_at) from cleanings x where x.room_id = r.id
                                                      and x.status in ('submitted', 'analyzing', 'approved')), '-infinity')) rq on true
  where me.role = 'admin' or pr.region = me.region
  order by pr.name, r.room_no
$$;
revoke execute on function today_board() from anon, public;
grant execute on function today_board() to authenticated;
