begin;

-- Shared links remain bearer tokens, but opening or editing one requires a Google session.
revoke execute on function public.gather_read_link(text), public.gather_save_link(text,jsonb,integer) from anon;
grant execute on function public.gather_read_link(text), public.gather_save_link(text,jsonb,integer) to authenticated;

notify pgrst, 'reload schema';
commit;
