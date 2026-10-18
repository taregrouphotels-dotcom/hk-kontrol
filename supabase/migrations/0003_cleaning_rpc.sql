-- Temizlik kaydı başlatma ve durum geçişleri (Faz 1: in_progress → submitted → approved; cancelled).
-- Hepsi security definer: yetkiyi fonksiyon kendisi kontrol eder, HK tabloya doğrudan yazmaz.
-- Çevrimdışı kuyruk aynı çağrıyı tekrar gönderebilir: başlatma ve üye ekleme tekrarlanınca hata vermez.

create or replace function _require_user() returns profiles
language plpgsql stable security definer set search_path = public as $$
declare me profiles;
begin
  select * into me from profiles where id = auth.uid() and active;
  if me.id is null then raise exception 'Oturum yok veya kullanıcı pasif' using errcode = '42501'; end if;
  return me;
end $$;

create or replace function _can_manage_room(r uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select is_admin() or is_region_sup(r) $$;

-- Cihazdan gelen zaman: çevrimdışı çekimde geçmişte olabilir, ama gelecekte veya 2 günden eski olamaz.
create or replace function _client_time(t timestamptz) returns timestamptz
language plpgsql stable as $$
begin
  if t is null then return now(); end if;
  if t > now() + interval '5 minutes' or t < now() - interval '2 days' then
    raise exception 'Geçersiz zaman: %', t using errcode = '22008';
  end if;
  return t;
end $$;

create or replace function start_cleaning(p_id uuid, p_room uuid, p_started_at timestamptz default null,
                                          p_via_qr boolean default true)
returns cleanings
language plpgsql volatile security definer set search_path = public as $$
declare
  me  profiles := _require_user();
  c   cleanings;
  t   timestamptz;
  d   date;
  ds  day_status;
begin
  select * into c from cleanings where id = p_id;
  if c.id is not null then
    if c.hk_id <> me.id or c.room_id <> p_room then raise exception 'Kayıt başka kullanıcıya ait' using errcode = '42501'; end if;
    return c;                                            -- tekrar gönderim
  end if;
  if not exists (select 1 from rooms where id = p_room and active) then
    raise exception 'Oda bulunamadı veya pasif' using errcode = 'P0002';
  end if;
  if me.role <> 'admin' and room_region(p_room) is distinct from me.region then
    raise exception 'Bu oda sizin bölgenizde değil' using errcode = '42501';
  end if;
  t := _client_time(p_started_at);
  d := (t at time zone 'Europe/Istanbul')::date;
  select status into ds from room_day_status where room_id = p_room and day = d;
  insert into cleanings (id, room_id, day, hk_id, type, status, started_at, started_via_qr, day_status, day_status_unknown)
  values (p_id, p_room, d, me.id,
          case when ds = 'stayover' then 'stayover'::cleaning_type else 'full'::cleaning_type end,
          'in_progress', t, coalesce(p_via_qr, true), ds, ds is null)
  returning * into c;
  return c;
end $$;

create or replace function _own_open_cleaning(p_cleaning uuid) returns cleanings
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _require_user(); c cleanings;
begin
  select * into c from cleanings where id = p_cleaning;
  if c.id is null or c.hk_id <> me.id then raise exception 'Kayıt bulunamadı' using errcode = 'P0002'; end if;
  return c;
end $$;

create or replace function add_cleaning_member(p_cleaning uuid, p_profile uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _own_open_cleaning(p_cleaning);
begin
  if c.status <> 'in_progress' then raise exception 'Kayıt açık değil' using errcode = '55000'; end if;
  if p_profile = c.hk_id then return; end if;
  if not exists (select 1 from profiles p where p.id = p_profile and p.active and p.role = 'hk'
                 and p.region = room_region(c.room_id)) then
    raise exception 'Bu kişi bölgedeki aktif bir HK değil' using errcode = '22023';
  end if;
  insert into cleaning_members (cleaning_id, profile_id) values (p_cleaning, p_profile) on conflict do nothing;
end $$;

create or replace function remove_cleaning_member(p_cleaning uuid, p_profile uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _own_open_cleaning(p_cleaning);
begin
  if c.status <> 'in_progress' then raise exception 'Kayıt açık değil' using errcode = '55000'; end if;
  delete from cleaning_members where cleaning_id = p_cleaning and profile_id = p_profile;
end $$;

create or replace function start_check(p_cleaning uuid, p_at timestamptz default null) returns cleanings
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _own_open_cleaning(p_cleaning);
begin
  if c.status <> 'in_progress' then raise exception 'Kayıt açık değil' using errcode = '55000'; end if;
  update cleanings set check_started_at = coalesce(check_started_at, greatest(_client_time(p_at), started_at))
  where id = p_cleaning returning * into c;
  return c;
end $$;

-- Zorunlu ve bu temizlik türüne uyan her adımın her karesi için çekim (veya "Uygulanamıyor") olmalı.
create or replace function missing_steps(p_cleaning uuid) returns table (step_id uuid, step_order int, shot int)
language sql stable security definer set search_path = public as $$
  select s.id, s.step_order, g.shot
  from cleanings c
  join rooms r        on r.id = c.room_id
  join check_steps s  on s.room_type_id = r.room_type_id and s.required and c.type = any (s.applies_to)
  cross join lateral generate_series(1, s.shots) as g(shot)
  where c.id = p_cleaning
    and (is_cleaning_participant(c.id) or _can_manage_room(c.room_id))
    and not exists (select 1 from step_results sr
                    where sr.cleaning_id = c.id and sr.step_id = s.id and sr.shot = g.shot
                      and (sr.media_key is not null or sr.skipped))
  order by s.step_order, g.shot
$$;

create or replace function submit_cleaning(p_cleaning uuid, p_at timestamptz default null) returns cleanings
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _own_open_cleaning(p_cleaning); n int;
begin
  if c.status = 'submitted' then return c; end if;      -- tekrar gönderim
  if c.status <> 'in_progress' then raise exception 'Kayıt açık değil' using errcode = '55000'; end if;
  if c.check_started_at is null then raise exception 'Kontrol başlatılmadı' using errcode = '55000'; end if;
  select count(*) into n from missing_steps(p_cleaning);
  if n > 0 then raise exception 'Eksik adım: %', n using errcode = '55000'; end if;
  update cleanings set status = 'submitted', finished_at = greatest(_client_time(p_at), check_started_at)
  where id = p_cleaning returning * into c;
  return c;
end $$;

-- ---------- Süpervizör / admin ----------
create or replace function _managed_cleaning(p_cleaning uuid) returns cleanings
language plpgsql stable security definer set search_path = public as $$
declare me profiles := _require_user(); c cleanings;
begin
  select * into c from cleanings where id = p_cleaning;
  if c.id is null or not _can_manage_room(c.room_id) then raise exception 'Kayıt bulunamadı' using errcode = 'P0002'; end if;
  return c;
end $$;

create or replace function approve_cleaning(p_cleaning uuid, p_note text default null) returns cleanings
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _managed_cleaning(p_cleaning);
begin
  if c.status not in ('submitted', 'escalated') then raise exception 'Onaylanacak durumda değil' using errcode = '55000'; end if;
  update cleanings set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
                       review_note = coalesce(nullif(trim(p_note), ''), review_note)
  where id = p_cleaning returning * into c;
  return c;
end $$;

create or replace function add_review_note(p_cleaning uuid, p_note text) returns cleanings
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _managed_cleaning(p_cleaning);
begin
  update cleanings set review_note = nullif(trim(p_note), ''), reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_cleaning returning * into c;
  return c;
end $$;

create or replace function cancel_cleaning(p_cleaning uuid, p_note text) returns cleanings
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _managed_cleaning(p_cleaning);
begin
  if c.status = 'cancelled' then return c; end if;
  if nullif(trim(p_note), '') is null then raise exception 'İptal nedeni yazılmalı' using errcode = '22023'; end if;
  update cleanings set status = 'cancelled', reviewed_by = auth.uid(), reviewed_at = now(), review_note = trim(p_note)
  where id = p_cleaning returning * into c;
  return c;
end $$;

create or replace function set_cleaning_type(p_cleaning uuid, p_type cleaning_type) returns cleanings
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _managed_cleaning(p_cleaning);
begin
  if c.status <> 'in_progress' then raise exception 'Tür sadece açık kayıtta değişir' using errcode = '55000'; end if;
  update cleanings set type = p_type where id = p_cleaning returning * into c;
  return c;
end $$;

create or replace function set_complaint(p_cleaning uuid, p_complaint boolean, p_note text default null) returns cleanings
language plpgsql volatile security definer set search_path = public as $$
declare c cleanings := _managed_cleaning(p_cleaning);
begin
  update cleanings set complaint = p_complaint,
                       complaint_note = case when p_complaint then coalesce(nullif(trim(p_note), ''), complaint_note) end
  where id = p_cleaning returning * into c;
  return c;
end $$;

-- ---------- Bugün ekranı ----------
-- Bölgedeki (admin: tüm) odaların bugünkü durumu ve son temizlik kaydı. HK'ya sadece durum + kişi döner.
create or replace function today_board() returns table (
  room_id uuid, property_id uuid, room_no text, room_type_code text, day_status day_status,
  cleaning_id uuid, cleaning_status cleaning_status, cleaning_type cleaning_type,
  hk_id uuid, hk_name text, members text[], started_at timestamptz, check_started_at timestamptz,
  finished_at timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (select * from profiles where id = auth.uid() and active),
       today as (select (now() at time zone 'Europe/Istanbul')::date as d)
  select r.id, r.property_id, r.room_no, rt.code, ds.status,
         c.id, c.status, c.type, c.hk_id, hp.full_name,
         (select array_agg(p.full_name order by p.full_name) from cleaning_members m join profiles p on p.id = m.profile_id
          where m.cleaning_id = c.id),
         c.started_at, c.check_started_at, c.finished_at
  from me, today
  join rooms r       on r.active
  join properties pr on pr.id = r.property_id
  join room_types rt on rt.id = r.room_type_id
  left join room_day_status ds on ds.room_id = r.id and ds.day = today.d
  left join lateral (select * from cleanings c where c.room_id = r.id and c.day = today.d and c.status <> 'cancelled'
                     order by c.started_at desc limit 1) c on true
  left join profiles hp on hp.id = c.hk_id
  where me.role = 'admin' or pr.region = me.region
  order by pr.name, r.room_no
$$;

grant execute on function give_consent(), start_cleaning(uuid, uuid, timestamptz, boolean),
  add_cleaning_member(uuid, uuid), remove_cleaning_member(uuid, uuid), start_check(uuid, timestamptz),
  missing_steps(uuid), submit_cleaning(uuid, timestamptz), approve_cleaning(uuid, text), add_review_note(uuid, text),
  cancel_cleaning(uuid, text), set_cleaning_type(uuid, cleaning_type), set_complaint(uuid, boolean, text),
  today_board() to authenticated;
-- İç yardımcılar dışarıdan çağrılmasın.
revoke execute on function _require_user(), _own_open_cleaning(uuid), _managed_cleaning(uuid) from authenticated;
