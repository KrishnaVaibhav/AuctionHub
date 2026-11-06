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
