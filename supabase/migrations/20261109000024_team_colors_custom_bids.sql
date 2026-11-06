-- 1. Each team in a league has its own colour.
-- 2. Hosts can turn off custom bid amounts (settings.custom_bids = false):
--    bidders can then only bid the next minimum, with no auto-bid maximum.

-- ---------------------------------------------------------------------------
-- Unique team colours (a trigger, so leagues that already share a colour keep working)
-- ---------------------------------------------------------------------------
create or replace function public.guard_team_color()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.league_teams t
     where t.auction_id = new.auction_id and t.id <> new.id and lower(t.color) = lower(new.color)
  ) then
    raise exception 'That colour is taken. Pick another.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger league_teams_color_guard before insert or update of color on public.league_teams
  for each row execute function public.guard_team_color();
revoke execute on function public.guard_team_color() from public, anon, authenticated;

-- join_league: same as 0023, but a taken colour becomes the next free one.
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
  col  text := lower(coalesce(p_color, '#f59e0b'));
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

  -- A colour another team already has (or the default sent by older clients)
  -- is swapped for the first free one, so joining never fails on colour.
  if exists (select 1 from public.league_teams t where t.auction_id = p_auction_id and lower(t.color) = col) then
    select c into col
      from unnest(array['#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#facc15', '#1e293b']) with ordinality as p(c, n)
     where not exists (select 1 from public.league_teams t where t.auction_id = p_auction_id and lower(t.color) = p.c)
     order by n
     limit 1;
    while col is null or exists (select 1 from public.league_teams t where t.auction_id = p_auction_id and lower(t.color) = col) loop
      col := '#' || lpad(to_hex((random() * 16777215)::int), 6, '0');
    end loop;
  end if;

  insert into public.league_teams (auction_id, owner_id, name, short_name, color, purse_left)
  values (p_auction_id, uid, btrim(p_name), upper(btrim(p_short_name)), col,
          public.league_setting(a.settings, 'purse', 1000000000))
  returning id into tid;
  return tid;
exception
  when unique_violation then
    raise exception 'You already have a team here, or that short name is taken' using errcode = 'P0001';
end;
$$;

-- ---------------------------------------------------------------------------
-- Custom bid amounts on or off
-- ---------------------------------------------------------------------------
create or replace function public._custom_bids_on(p_settings jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((p_settings ->> 'custom_bids')::boolean, true);
$$;

-- Standard bidding: same wrapper as before, plus the custom-bid rule.
create or replace function public.place_bid(p_lot_id uuid, p_amount numeric, p_max_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t   text;
  s   jsonb;
  nxt numeric;
begin
  select l.sale_type, a.settings into t, s
    from public.lots l join public.auctions a on a.id = l.auction_id
   where l.id = p_lot_id;
  if t = 'dutch' then
    raise exception 'This is a Dutch lot. Accept the current price to buy it.' using errcode = 'P0001';
  elsif t = 'sealed' then
    raise exception 'This lot takes sealed bids' using errcode = 'P0001';
  elsif t = 'offer' then
    raise exception 'This lot takes offers' using errcode = 'P0001';
  end if;
  if not public._custom_bids_on(s) then
    if p_max_amount is not null then
      raise exception 'Auto-bid is off in this auction' using errcode = 'P0001';
    end if;
    nxt := public.min_next_bid(p_lot_id);
    if p_amount <> nxt then
      raise exception 'This auction only takes the next bid: %', public.format_money(nxt, s) using errcode = 'P0001';
    end if;
  end if;
  return public._place_bid_english(p_lot_id, p_amount, p_max_amount);
end;
$$;
revoke execute on function public.place_bid(uuid, numeric, numeric) from public, anon;
grant execute on function public.place_bid(uuid, numeric, numeric) to authenticated;

-- League bidding: wrap the engine the same way.
alter function public.league_bid(uuid, numeric) rename to _league_bid_core;
revoke execute on function public._league_bid_core(uuid, numeric) from public, anon, authenticated;

create or replace function public.league_bid(p_lot_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s   jsonb;
  nxt numeric;
begin
  select a.settings into s from public.lots l join public.auctions a on a.id = l.auction_id where l.id = p_lot_id;
  if s is not null and not public._custom_bids_on(s) then
    nxt := public.min_next_bid(p_lot_id);
    if p_amount <> nxt then
      raise exception 'This league only takes the next bid: %', public.format_money(nxt, s) using errcode = 'P0001';
    end if;
  end if;
  return public._league_bid_core(p_lot_id, p_amount);
end;
$$;
revoke execute on function public.league_bid(uuid, numeric) from public, anon;
grant execute on function public.league_bid(uuid, numeric) to authenticated;
