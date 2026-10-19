-- İlk admin: Supabase panelinden açılan hesap (config/team.json → first_admin) ilk girişte admin profilini kendisi alır.
-- Sadece hiç admin yokken ve sadece bu e-postayla çalışır; sonraki kullanıcıları admin panelinden adminler açar.

create or replace function claim_first_admin() returns profiles
language plpgsql volatile security definer set search_path = public as $$
declare me profiles;
begin
  if auth.uid() is null then raise exception 'Oturum yok' using errcode = '42501'; end if;
  select * into me from profiles where id = auth.uid();
  if me.id is not null then return me; end if;
  if exists (select 1 from profiles where role = 'admin') then
    raise exception 'Hesabınız tanımlı değil' using errcode = '42501';
  end if;
  if (select lower(email) from auth.users where id = auth.uid()) is distinct from 'gokcercakir@gmail.com' then
    raise exception 'Hesabınız tanımlı değil' using errcode = '42501';
  end if;
  insert into profiles (id, full_name, role) values (auth.uid(), 'Gökçer Çakır', 'admin') returning * into me;
  return me;
end $$;

grant execute on function claim_first_admin() to authenticated;
