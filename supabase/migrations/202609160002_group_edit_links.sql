begin;

-- Bearer links are separate from group IDs and never appear in group table reads.
create table if not exists gather_private.edit_links (
  group_id uuid primary key references public.gather_groups(id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$')
);
revoke all on gather_private.edit_links from public, anon, authenticated;

create or replace function public.gather_edit_link(gid uuid, replace_link boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  perform 1 from public.gather_groups where id = gid for update;
  if not found or not gather_private.is_owner(gid) then raise exception 'Only the owner can manage the group link.'; end if;
  select token into secret from gather_private.edit_links where group_id = gid;
  if secret is null or replace_link then
    secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into gather_private.edit_links(group_id, token) values (gid, secret)
      on conflict (group_id) do update set token = excluded.token;
  end if;
  return secret;
end $$;

create or replace function public.gather_read_link(link_token text)
returns table(id uuid, document jsonb, version integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query select g.id, g.document, g.version from public.gather_groups g
    join gather_private.edit_links l on l.group_id = g.id where l.token = link_token;
  if not found then raise exception 'This group link is invalid or has been replaced. Ask the owner for a new link.'; end if;
end $$;

create or replace function public.gather_save_link(link_token text, doc jsonb, expected_version integer)
returns table(id uuid, document jsonb, version integer)
language plpgsql security definer set search_path = '' as $$
declare item public.gather_groups;
begin
  select g.* into item from public.gather_groups g join gather_private.edit_links l on l.group_id = g.id
    where l.token = link_token for update of g;
  -- Recheck after acquiring the same group lock used by rotation and deletion.
  if not found or not exists(select 1 from gather_private.edit_links l where l.group_id = item.id and l.token = link_token) then
    raise exception 'This group link is invalid or has been replaced. Ask the owner for a new link.';
  end if;
  if item.version is distinct from expected_version then raise exception 'Group changed. Refresh and try again.'; end if;
  if doc->'closed' is distinct from item.document->'closed' then raise exception 'Only the owner can close or reopen the group.'; end if;
  if item.document->>'closed' = 'true' then raise exception 'This group is closed. Ask the owner to reopen it.'; end if;
  return query update public.gather_groups g set document = doc, version = g.version + 1
    where g.id = item.id returning g.id, g.document, g.version;
end $$;

revoke all on function public.gather_edit_link(uuid,boolean), public.gather_read_link(text), public.gather_save_link(text,jsonb,integer) from public, anon, authenticated;
grant execute on function public.gather_edit_link(uuid,boolean) to authenticated;
grant execute on function public.gather_read_link(text), public.gather_save_link(text,jsonb,integer) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
