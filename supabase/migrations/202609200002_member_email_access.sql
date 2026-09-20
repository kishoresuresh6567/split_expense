begin;

-- Email addresses on expense participants grant access only after Google sign-in.
-- Read the current verified address from auth.users, not a JWT claim.
create or replace function gather_private.can_access(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select gather_private.is_owner(gid) or exists (
    select 1 from public.gather_groups g,
      jsonb_array_elements(g.document->'members') member
    where g.id = gid and lower(member->>'email') = gather_private.email()
      and member->>'email' is not null
  )
$$;

create function gather_private.valid_member_emails(doc jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(email = lower(trim(email))
    and length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'), true)
    and count(distinct email) = count(*)
  from (
    select member->>'email' as email from jsonb_array_elements(doc->'members') member
    where nullif(member->>'email', '') is not null
  ) addresses
$$;

alter table public.gather_groups add constraint valid_member_emails
  check (gather_private.valid_member_emails(document));

-- A shared edit link may change expenses but cannot grant sign-in access.
create or replace function public.gather_save_link(link_token text, doc jsonb, expected_version integer)
returns table(id uuid, document jsonb, version integer)
language plpgsql security definer set search_path = '' as $$
declare item public.gather_groups;
begin
  select g.* into item from public.gather_groups g join gather_private.edit_links l on l.group_id = g.id
    where l.token = link_token for update of g;
  if not found or not exists(select 1 from gather_private.edit_links l where l.group_id = item.id and l.token = link_token) then
    raise exception 'This group link is invalid or has been replaced. Ask the owner for a new link.';
  end if;
  if item.version is distinct from expected_version then raise exception 'Group changed. Refresh and try again.'; end if;
  if doc->'closed' is distinct from item.document->'closed' then raise exception 'Only the owner can close or reopen the group.'; end if;
  if doc->'members' is distinct from item.document->'members' then
    raise exception 'Only the owner can manage members and their access.';
  end if;
  if item.document->>'closed' = 'true' then raise exception 'This group is closed. Ask the owner to reopen it.'; end if;
  return query update public.gather_groups g set document = doc, version = g.version + 1
    where g.id = item.id returning g.id, g.document, g.version;
end $$;

notify pgrst, 'reload schema';
commit;
