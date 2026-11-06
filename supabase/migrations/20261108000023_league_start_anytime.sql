-- The host decides when a league goes live.
--
-- Before: start_auction refused a league with fewer than 2 teams, and teams
-- could only join while it was scheduled. Hosts testing alone (or waiting for
-- late teams) were stuck. Now the host can start whenever they like, and teams
-- can still join after the start (live or paused) until the league is full.

create or replace function public.start_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions := public._assert_host(p_auction_id);
begin
  if a.status not in ('draft', 'scheduled') then
    raise exception 'Auction already started' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.lots where auction_id = p_auction_id and status = 'pending') then
    raise exception 'Add at least one lot first' using errcode = 'P0001';
  end if;
  perform public._start_auction(p_auction_id);
end;
$$;

create or replace function public.join_league(p_auction_id uuid, p_name text, p_short_name text, p_color text default '#f59e0b')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  a    public.auctions;
  tid  uuid;
begin
  if uid is null then
    raise exception 'Sign in to join' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = p_auction_id for update;
  if a.id is null or a.mode <> 'league' then
    raise exception 'This is not a league auction' using errcode = 'P0001';
  end if;
  if a.status = 'draft' then
    raise exception 'Teams can join once the host schedules the league' using errcode = 'P0001';
  end if;
  if a.status not in ('scheduled', 'live', 'paused') then
    raise exception 'This league has ended' using errcode = 'P0001';
  end if;
  if a.host_id = uid and coalesce((a.settings -> 'league' ->> 'host_can_play')::boolean, false) = false then
    raise exception 'The host is not playing in this league' using errcode = 'P0001';
  end if;
  if (select count(*) from public.league_teams where auction_id = p_auction_id)
     >= public.league_setting(a.settings, 'max_teams', 10) then
    raise exception 'The league is full' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.id = uid and p.banned_until > now()) then
    raise exception 'Your account is suspended' using errcode = 'P0001';
  end if;

  insert into public.league_teams (auction_id, owner_id, name, short_name, color, purse_left)
  values (p_auction_id, uid, btrim(p_name), upper(btrim(p_short_name)), coalesce(p_color, '#f59e0b'),
          public.league_setting(a.settings, 'purse', 1000000000))
  returning id into tid;
  return tid;
exception
  when unique_violation then
    raise exception 'You already have a team here, or that short name is taken' using errcode = 'P0001';
end;
$$;
