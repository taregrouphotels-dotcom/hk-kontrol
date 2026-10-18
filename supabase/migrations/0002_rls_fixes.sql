-- 0001_init üzerindeki yetki düzeltmeleri.
-- 1) cleanings <-> cleaning_members / step_results politikaları birbirini sorguluyordu: "infinite recursion in policy".
--    Kayıt bilgisi artık security definer yardımcılarla okunuyor (RLS'e takılmaz, döngü olmaz).
-- 2) HK, cleanings tablosuna doğrudan yazamaz; başlatma ve durum geçişleri 0003_cleaning_rpc.sql'deki fonksiyonlarla.
--    Böylece reviewed_by, complaint, ai_overall gibi alanlara HK dokunamaz.
-- 3) Kullanıcı kendi profilini doğrudan güncelleyemez; KVKK onayı give_consent() ile.
-- 4) HK, bölgedeki bugünkü başka kayıtları tablo üzerinden göremez; Bugün ekranı today_board() ile
--    sadece durum + kişi görür (fotoğraf, not, şikayet görünmez).

-- ---------- Yardımcılar ----------
create or replace function cleaning_room(c uuid) returns uuid
language sql stable security definer set search_path = public as
$$ select room_id from cleanings where id = c $$;

create or replace function is_cleaning_owner(c uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from cleanings where id = c and hk_id = auth.uid()) $$;

create or replace function is_cleaning_participant(c uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from cleanings where id = c and hk_id = auth.uid())
       or exists (select 1 from cleaning_members where cleaning_id = c and profile_id = auth.uid()) $$;

-- ---------- cleanings ----------
drop policy hk_read_own   on cleanings;
drop policy hk_read_today on cleanings;
drop policy hk_insert     on cleanings;
drop policy hk_update     on cleanings;

create policy hk_read_own on cleanings for select using (is_cleaning_participant(id));

-- ---------- cleaning_members ----------
drop policy sup_members on cleaning_members;
drop policy hk_members  on cleaning_members;

create policy sup_members on cleaning_members for all
  using (is_region_sup(cleaning_room(cleaning_id))) with check (is_region_sup(cleaning_room(cleaning_id)));
create policy participant_members_read on cleaning_members for select
  using (is_cleaning_participant(cleaning_id));

-- ---------- step_results ----------
drop policy sup_steps       on step_results;
drop policy hk_steps_read   on step_results;
drop policy hk_steps_insert on step_results;

create policy sup_steps on step_results for all
  using (is_region_sup(cleaning_room(cleaning_id))) with check (is_region_sup(cleaning_room(cleaning_id)));
create policy participant_steps_read on step_results for select
  using (is_cleaning_participant(cleaning_id));
-- Adım fotoğrafını kaydı başlatan HK ekler (telefon onda). Sadece açık kayda, AI alanları boş.
create policy hk_steps_insert on step_results for insert with check (
  is_cleaning_owner(cleaning_id)
  and exists (select 1 from cleanings c where c.id = cleaning_id and c.status in ('in_progress', 'fixing'))
  and ai_status = 'pending' and ai_result is null and not ai_false_alarm and media_deleted_at is null);

-- ---------- profiles ----------
drop policy own_consent_update on profiles;

create or replace function give_consent() returns timestamptz
language sql volatile security definer set search_path = public as
$$ update profiles set consent_at = coalesce(consent_at, now())
   where id = auth.uid() and active
   returning consent_at $$;

-- ---------- Yeni alanlar ----------
alter table cleanings
  add column day_status         day_status,                       -- başlatıldığı andaki günlük durum
  add column day_status_unknown boolean not null default false;   -- durum yoktu, tam kontrol varsayıldı

-- ---------- Supabase varsayılan yetkileri ----------
-- Supabase yeni fonksiyonları anon'a da açar; giriş yapmamış kullanıcı hiçbirini çağıramasın.
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;
