begin;

create table if not exists public.gather_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 60)
);
revoke all on public.gather_profiles from public, anon, authenticated;

create function public.gather_my_name() returns text
language sql stable security definer set search_path = '' as $$
  select display_name from public.gather_profiles where user_id = (select auth.uid())
$$;

create function public.gather_set_my_name(new_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare cleaned text := trim(new_name);
begin
  if auth.uid() is null or gather_private.email() is null then raise exception 'Sign in with Google first.'; end if;
  if cleaned is null or length(cleaned) not between 1 and 60 then raise exception 'Enter a name of 1 to 60 characters.'; end if;
  insert into public.gather_profiles(user_id, display_name) values (auth.uid(), cleaned)
    on conflict (user_id) do update set display_name = excluded.display_name;
  return cleaned;
end $$;

create function public.gather_member_names(gid uuid)
returns table(email text, display_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not gather_private.can_access(gid) then raise exception 'Group unavailable.'; end if;
  return query select distinct lower(u.email)::text, p.display_name
    from public.gather_groups g
    cross join jsonb_array_elements(g.document->'members') member
    join auth.users u on lower(u.email) = lower(member->>'email') and u.email_confirmed_at is not null
    join public.gather_profiles p on p.user_id = u.id
    where g.id = gid;
end $$;

revoke all on function public.gather_my_name(), public.gather_set_my_name(text), public.gather_member_names(uuid) from public, anon, authenticated;
grant execute on function public.gather_my_name(), public.gather_set_my_name(text), public.gather_member_names(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
