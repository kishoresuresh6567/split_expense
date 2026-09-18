begin;

-- Accounts manage only groups they created. All other access uses an edit link.
create or replace function gather_private.can_access(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gather_private.is_owner(gid)
$$;

drop function if exists public.gather_invite(uuid,text);
drop function if exists public.gather_accept_invitation(uuid);
drop function if exists public.gather_revoke(uuid,uuid,uuid);
drop function if exists public.gather_access_list(uuid);

-- Preserve historical records, but they no longer grant access or expose emails.
revoke all on public.gather_memberships, public.gather_invitations from public, anon, authenticated;
drop policy if exists owner_or_self_read on public.gather_memberships;
drop policy if exists invitation_read on public.gather_invitations;

notify pgrst, 'reload schema';
commit;
