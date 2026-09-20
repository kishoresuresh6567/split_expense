begin;

-- Google sign-in alone does not make a shared link an invitation.
create or replace function public.gather_read_link(link_token text)
returns table(id uuid, document jsonb, version integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query select g.id, g.document, g.version from public.gather_groups g
    join gather_private.edit_links l on l.group_id = g.id
    where l.token = link_token and gather_private.can_access(g.id);
  if not found then raise exception 'Group unavailable. Sign in with an email listed in this group.'; end if;
end $$;

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
  if not gather_private.can_access(item.id) then raise exception 'Group unavailable. Sign in with an email listed in this group.'; end if;
  if item.version is distinct from expected_version then raise exception 'Group changed. Refresh and try again.'; end if;
  if doc->'closed' is distinct from item.document->'closed' then raise exception 'Only the owner can close or reopen the group.'; end if;
  if doc->'members' is distinct from item.document->'members' then raise exception 'Only the owner can manage members and their access.'; end if;
  if item.document->>'closed' = 'true' then raise exception 'This group is closed. Ask the owner to reopen it.'; end if;
  return query update public.gather_groups g set document = doc, version = g.version + 1
    where g.id = item.id returning g.id, g.document, g.version;
end $$;

notify pgrst, 'reload schema';
commit;
