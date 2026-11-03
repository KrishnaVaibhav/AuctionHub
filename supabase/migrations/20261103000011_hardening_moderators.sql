-- Hardening + moderator management.

-- Supabase's default grants include TRUNCATE/TRIGGER/REFERENCES, and TRUNCATE
-- bypasses RLS. PostgREST never issues them, but remove them anyway.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.tablename);
  end loop;
end;
$$;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;

-- Anonymous visitors never write these.
revoke insert, update, delete on public.watchlist, public.auction_moderators, public.chat_mutes from anon;

-- Host adds a moderator by username (moderators can moderate chat and see private auctions).
create or replace function public.add_moderator(p_auction_id uuid, p_username text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a    public.auctions := public._assert_host(p_auction_id);
  uid  uuid;
begin
  select id into uid from public.profiles where lower(username) = lower(btrim(ltrim(p_username, '@')));
  if uid is null then
    raise exception 'No user with that username' using errcode = 'P0001';
  end if;
  if uid = a.host_id then
    raise exception 'You are already the host' using errcode = 'P0001';
  end if;
  insert into public.auction_moderators (auction_id, user_id) values (p_auction_id, uid) on conflict do nothing;
  return uid;
end;
$$;
revoke execute on function public.add_moderator(uuid, text) from public, anon;
grant execute on function public.add_moderator(uuid, text) to authenticated;
