begin;

-- Expense participants are names in the document. Access is a separate,
-- authenticated relationship and can never be granted by editing that document.
create table public.gather_groups (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  document jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  constraint valid_document check (coalesce((
    jsonb_typeof(document) = 'object' and document->>'id' = id::text
    and length(document->>'name') between 1 and 60
    and jsonb_typeof(document->'members') = 'array'
    and jsonb_typeof(document->'expenses') = 'array'
    and jsonb_typeof(document->'payments') = 'array'
    and octet_length(document::text) <= 2000000
    and document ?& array['id','name','members','expenses','payments']
  ), false))
);
create table public.gather_memberships (
  group_id uuid references public.gather_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (group_id, user_id)
);
create table public.gather_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.gather_groups(id) on delete cascade,
  group_name text not null,
  email text not null check (email = lower(trim(email)) and length(email) between 3 and 254 and position('@' in email) > 1),
  expires_at timestamptz not null default now() + interval '7 days',
  unique(group_id, email)
);
create index on public.gather_memberships(user_id);
create index on public.gather_invitations(email);

create schema if not exists gather_private;
revoke all on schema gather_private from public;
grant usage on schema gather_private to authenticated;

-- Read the current confirmed address from Auth, not mutable user_metadata
-- or an old JWT email claim. Revocations take effect on the next request.
create function gather_private.email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = (select auth.uid()) and email_confirmed_at is not null
$$;
create function gather_private.is_owner(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.gather_groups where id = gid and owner_id = (select auth.uid()))
$$;
create function gather_private.can_access(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gather_private.is_owner(gid) or exists(
    select 1 from public.gather_memberships where group_id = gid and user_id = (select auth.uid())
  )
$$;
revoke all on all functions in schema gather_private from public, anon;
grant execute on all functions in schema gather_private to authenticated;

alter table public.gather_groups enable row level security;
alter table public.gather_memberships enable row level security;
alter table public.gather_invitations enable row level security;
revoke all on public.gather_groups, public.gather_memberships, public.gather_invitations from public, anon, authenticated;
grant select on public.gather_groups, public.gather_memberships, public.gather_invitations to authenticated;
create policy member_read on public.gather_groups for select to authenticated using (gather_private.can_access(id));
create policy owner_or_self_read on public.gather_memberships for select to authenticated
  using (user_id = (select auth.uid()) or gather_private.is_owner(group_id));
create policy invitation_read on public.gather_invitations for select to authenticated
  using (gather_private.is_owner(group_id) or (email = gather_private.email() and expires_at > now()));

-- Only these functions write data; no client may write ACLs or ownership directly.
create function public.gather_create_group(doc jsonb) returns public.gather_groups
language plpgsql security definer set search_path = '' as $$
declare result public.gather_groups;
begin
  if auth.uid() is null or gather_private.email() is null then raise exception 'Sign in with a verified email.'; end if;
  insert into public.gather_groups(id, owner_id, document)
    values ((doc->>'id')::uuid, auth.uid(), doc) returning * into result;
  return result;
end $$;

create function public.gather_save_group(gid uuid, doc jsonb, expected_version integer) returns public.gather_groups
language plpgsql security definer set search_path = '' as $$
declare result public.gather_groups;
begin
  select * into result from public.gather_groups where id = gid for update;
  if not found or not gather_private.can_access(gid) then raise exception 'Group unavailable.'; end if;
  if result.version is distinct from expected_version then raise exception 'Group changed. Refresh and try again.'; end if;
  if (doc->'closed' is distinct from result.document->'closed' or doc->'members' is distinct from result.document->'members' or doc->'name' is distinct from result.document->'name')
      and not gather_private.is_owner(gid) then raise exception 'Only the owner can manage this group.'; end if;
  if result.document->>'closed' = 'true' and (doc - 'closed') is distinct from (result.document - 'closed') then
    raise exception 'Reopen this group before making changes.';
  end if;
  update public.gather_groups set document = doc, version = version + 1 where id = gid returning * into result;
  return result;
end $$;

create function public.gather_delete_group(gid uuid, expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  select version into v from public.gather_groups where id = gid for update;
  if not found or not gather_private.is_owner(gid) then raise exception 'Only the owner can delete this group.'; end if;
  if v is distinct from expected_version then raise exception 'Group changed. Refresh and try again.'; end if;
  delete from public.gather_groups where id = gid;
end $$;

create function public.gather_invite(gid uuid, invite_email text) returns public.gather_invitations
language plpgsql security definer set search_path = '' as $$
declare result public.gather_invitations;
begin
  perform 1 from public.gather_groups where id = gid for update;
  if not found or not gather_private.is_owner(gid) then raise exception 'Only the owner can invite members.'; end if;
  if lower(trim(invite_email)) = gather_private.email() then raise exception 'You already own this group.'; end if;
  insert into public.gather_invitations(group_id, group_name, email)
    values (gid, (select document->>'name' from public.gather_groups where id = gid), lower(trim(invite_email)))
    on conflict (group_id, email) do update set id = gen_random_uuid(), group_name = excluded.group_name, expires_at = now() + interval '7 days'
    returning * into result;
  return result;
end $$;

create function public.gather_accept_invitation(invitation_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation public.gather_invitations;
begin
  select * into invitation from public.gather_invitations where id = invitation_id;
  if not found then raise exception 'Invitation unavailable or expired.'; end if;
  -- Same lock order as revoke/delete prevents accepting an invitation after revocation.
  perform 1 from public.gather_groups where id = invitation.group_id for update;
  select * into invitation from public.gather_invitations where id = invitation_id for update;
  if not found or invitation.expires_at <= now() or invitation.email is distinct from gather_private.email() then
    raise exception 'Invitation unavailable or expired. Sign in with the invited email.';
  end if;
  insert into public.gather_memberships(group_id, user_id) values (invitation.group_id, auth.uid()) on conflict do nothing;
  delete from public.gather_invitations where id = invitation_id;
  return invitation.group_id;
end $$;

create function public.gather_revoke(gid uuid, member_id uuid default null, invitation_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.gather_groups where id = gid for update;
  if not found or not gather_private.is_owner(gid) then raise exception 'Only the owner can revoke access.'; end if;
  if member_id is not null then
    -- Also invalidate a second pending invitation to the same account.
    delete from public.gather_invitations where group_id = gid and email = (select lower(email) from auth.users where id = member_id);
    delete from public.gather_memberships where group_id = gid and user_id = member_id;
  end if;
  delete from public.gather_invitations where group_id = gid and id = invitation_id;
end $$;

create function public.gather_access_list(gid uuid) returns table(user_id uuid, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not gather_private.is_owner(gid) then raise exception 'Only the owner can manage access.'; end if;
  return query select u.id, u.email::text from auth.users u join public.gather_memberships m on m.user_id = u.id where m.group_id = gid;
end $$;

revoke all on function public.gather_create_group(jsonb), public.gather_save_group(uuid,jsonb,integer),
  public.gather_delete_group(uuid,integer), public.gather_invite(uuid,text), public.gather_accept_invitation(uuid),
  public.gather_revoke(uuid,uuid,uuid), public.gather_access_list(uuid) from public, anon;
grant execute on function public.gather_create_group(jsonb), public.gather_save_group(uuid,jsonb,integer),
  public.gather_delete_group(uuid,integer), public.gather_invite(uuid,text), public.gather_accept_invitation(uuid),
  public.gather_revoke(uuid,uuid,uuid), public.gather_access_list(uuid) to authenticated;
commit;
