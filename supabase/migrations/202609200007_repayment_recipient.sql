begin;

-- Compare against the saved member list, so changing an email in the proposed
-- document cannot grant permission to record or undo somebody else's repayment.
create function gather_private.payment_changes_allowed(old_doc jsonb, new_doc jsonb) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare old_payment jsonb;
declare new_payment jsonb;
declare recipient_email text;
begin
  if jsonb_typeof(new_doc->'payments') is distinct from 'array' then return false; end if;
  if (select count(*) from jsonb_array_elements(new_doc->'payments')) is distinct from
     (select count(distinct item->>'id') from jsonb_array_elements(new_doc->'payments') item) then return false; end if;
  for new_payment in select value from jsonb_array_elements(new_doc->'payments') loop
    if jsonb_typeof(new_payment) is distinct from 'object' or nullif(new_payment->>'id','') is null then return false; end if;
    select value into old_payment from jsonb_array_elements(old_doc->'payments')
      where value->>'id' = new_payment->>'id' limit 1;
    if old_payment is not null then
      if new_payment is distinct from old_payment then return false; end if;
    else
      select lower(member->>'email') into recipient_email from jsonb_array_elements(old_doc->'members') member
        where member->>'id' = new_payment->>'to' limit 1;
      if coalesce(recipient_email = gather_private.email(), false) is false then return false; end if;
    end if;
  end loop;
  for old_payment in select value from jsonb_array_elements(old_doc->'payments') loop
    if not exists(select 1 from jsonb_array_elements(new_doc->'payments') item where item->>'id' = old_payment->>'id') then
      select lower(member->>'email') into recipient_email from jsonb_array_elements(old_doc->'members') member
        where member->>'id' = old_payment->>'to' limit 1;
      if coalesce(recipient_email = gather_private.email(), false) is false then return false; end if;
    end if;
  end loop;
  return true;
end $$;

revoke all on function gather_private.payment_changes_allowed(jsonb,jsonb) from public, anon;

create or replace function public.gather_save_group(gid uuid, doc jsonb, expected_version integer) returns public.gather_groups
language plpgsql security definer set search_path = '' as $$
declare result public.gather_groups;
begin
  select * into result from public.gather_groups where id = gid for update;
  if not found or not gather_private.can_access(gid) then raise exception 'Group unavailable.'; end if;
  if result.version is distinct from expected_version then raise exception 'Group changed. Refresh and try again.'; end if;
  if (doc->'closed' is distinct from result.document->'closed' or doc->'name' is distinct from result.document->'name')
      and not gather_private.is_owner(gid) then raise exception 'Only the creator can rename or close this group.'; end if;
  if result.document->>'closed' = 'true' and (doc - 'closed') is distinct from (result.document - 'closed') then
    raise exception 'Reopen this group before making changes.';
  end if;
  if not gather_private.expense_changes_allowed(gid, result.document, doc) then
    raise exception 'Only the person who added or paid an expense can edit or delete it.';
  end if;
  if not gather_private.payment_changes_allowed(result.document, doc) then
    raise exception 'Only the member receiving a repayment can record or undo it.';
  end if;
  update public.gather_groups set document = doc, version = version + 1 where id = gid returning * into result;
  return result;
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
  if doc->'name' is distinct from item.document->'name' and not gather_private.is_owner(item.id) then
    raise exception 'Only the creator can rename this group.';
  end if;
  if item.document->>'closed' = 'true' then raise exception 'This group is closed. Ask the owner to reopen it.'; end if;
  if not gather_private.expense_changes_allowed(item.id, item.document, doc) then
    raise exception 'Only the person who added or paid an expense can edit or delete it.';
  end if;
  if not gather_private.payment_changes_allowed(item.document, doc) then
    raise exception 'Only the member receiving a repayment can record or undo it.';
  end if;
  return query update public.gather_groups g set document = doc, version = g.version + 1
    where g.id = item.id returning g.id, g.document, g.version;
end $$;

notify pgrst, 'reload schema';
commit;
