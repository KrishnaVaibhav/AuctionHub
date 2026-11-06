-- Concurrency fixes found in a review of the bidding and league code.
--
-- 1. Bid vs host deadlock. Host controls locked the auction row FOR UPDATE.
--    A bid holds its lot lock and then inserts a chat line, whose foreign key
--    needs a KEY SHARE lock on the same auction row. FOR UPDATE blocks KEY SHARE,
--    so "host closes a lot" + "someone bids on it" could deadlock. Hosts now
--    take FOR NO KEY UPDATE, which still serializes host actions but lets
--    bids, chat and other inserts that reference the auction through.
-- 2. Two players on the block. Every viewer calls league_tick when the timer
--    ends; concurrent calls could each open a different next player.
--    _league_open_next now locks the auction row and re-checks.
-- 3. Trade deadlock. Two opposite trades accepted at once locked the two teams
--    in opposite order. Teams are now locked in id order.
-- 4. Host actions that locked the lot before the auction (the reverse of every
--    other host action) now check the host first: set_lot_end, reopen_lot,
--    respond_offer, league_retain, league_unretain.


create or replace function public._assert_host(p_auction_id uuid)
returns public.auctions
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions;
begin
  select * into a from public.auctions where id = p_auction_id for no key update;
  if a.id is null then
    raise exception 'Auction not found' using errcode = 'P0001';
  end if;
  if a.host_id is distinct from auth.uid()
     and not exists (select 1 from public.auction_moderators m
                      where m.auction_id = p_auction_id and m.user_id = auth.uid() and m.can_run) then
    raise exception 'Only the host can do this' using errcode = 'P0001';
  end if;
  return a;
end;
$$;

create or replace function public._start_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         public.auctions;
  base_end  timestamptz;
  stagger   int;
  first_id  uuid;
begin
  select * into a from public.auctions where id = p_auction_id for no key update;
  if a.id is null or a.status not in ('draft', 'scheduled') then
    return;
  end if;

  if a.mode = 'league' then
    select id into first_id from public.lots
     where auction_id = p_auction_id and status = 'pending'
     order by position, created_at limit 1;
    update public.lots
       set status = 'open', opens_at = now(),
           ends_at = now() + make_interval(secs => public.league_setting(a.settings, 'lot_seconds', 30)::int)
     where id = first_id;
    update public.auctions
       set status = 'live', starts_at = least(coalesce(starts_at, now()), now()), ends_at = null
     where id = p_auction_id;
    perform public._chat_system(p_auction_id, 'system', 'The league auction is live. First player is on the block!');
    return;
  end if;

  stagger := greatest(coalesce((a.settings ->> 'lot_stagger_seconds')::int, 0), 0);
  base_end := case
                when a.ends_at is not null and a.ends_at > now() + interval '1 minute' then a.ends_at
                else now() + make_interval(mins => greatest(coalesce((a.settings ->> 'lot_duration_minutes')::int, 10), 1))
              end;

  update public.lots l
     set status = 'open',
         opens_at = now(),
         ends_at = base_end + make_interval(secs => stagger * (r.rn - 1))
    from (
      select id, row_number() over (order by position, created_at) as rn
      from public.lots where auction_id = p_auction_id and status = 'pending'
    ) r
   where l.id = r.id;

  update public.auctions
     set status = 'live',
         starts_at = least(coalesce(starts_at, now()), now()),
         ends_at = (select max(ends_at) from public.lots where auction_id = p_auction_id)
   where id = p_auction_id;

  perform public._chat_system(p_auction_id, 'system', 'The auction is live. Good luck!');
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
  col  text := lower(coalesce(p_color, '#f59e0b'));
begin
  if uid is null then
    raise exception 'Sign in to join' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = p_auction_id for no key update;
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

create or replace function public._league_open_next(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       public.auctions;
  next_id uuid;
  opens   timestamptz;
begin
  -- Serialize: concurrent ticks must not each open a different player.
  select * into a from public.auctions where id = p_auction_id for no key update;
  if a.id is null or a.mode <> 'league' or a.status not in ('live', 'paused') then
    return;
  end if;
  if exists (select 1 from public.lots where auction_id = p_auction_id and status = 'open') then
    return;
  end if;
  select id into next_id from public.lots
   where auction_id = p_auction_id and status = 'pending'
   order by position, created_at
   limit 1
   for update skip locked;
  if next_id is null then
    perform public._end_auction_if_done(p_auction_id);
    return;
  end if;
  opens := now() + make_interval(secs => public.league_setting(a.settings, 'break_seconds', 5)::int);
  update public.lots
     set status = 'open', opens_at = opens,
         ends_at = opens + make_interval(secs => public.league_setting(a.settings, 'lot_seconds', 30)::int)
   where id = next_id;
end;
$$;

create or replace function public.league_respond_trade(p_trade_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  tr  public.league_trades;
  a   public.auctions;
  ft  public.league_teams;
  tt  public.league_teams;
begin
  select * into tr from public.league_trades where id = p_trade_id for update;
  if tr.id is null or tr.status <> 'pending' then
    raise exception 'This trade is no longer pending' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = tr.auction_id;
  -- Lock both teams in id order so opposite trades can't deadlock.
  perform 1 from public.league_teams where id in (tr.from_team, tr.to_team) order by id for update;
  select * into ft from public.league_teams where id = tr.from_team;
  select * into tt from public.league_teams where id = tr.to_team;

  -- The proposer or the host may cancel; only the receiving team may accept or reject.
  if not p_accept and (ft.owner_id = uid or a.host_id = uid) and tt.owner_id <> uid then
    update public.league_trades set status = 'cancelled', responded_at = now() where id = tr.id;
    return;
  end if;
  if tt.owner_id <> uid then
    raise exception 'Only the other team can answer this trade' using errcode = 'P0001';
  end if;
  if not p_accept then
    update public.league_trades set status = 'rejected', responded_at = now() where id = tr.id;
    perform public._notify(ft.owner_id, 'system', 'Trade rejected', format('%s rejected your trade.', tt.name), '/a/' || a.id, 'trade-done:' || tr.id);
    return;
  end if;

  perform public._trade_check(tr, a);
  update public.lots set winner_team_id = tt.id, current_winner_id = tt.owner_id where id = any (tr.give_lots);
  update public.lots set winner_team_id = ft.id, current_winner_id = ft.owner_id where id = any (tr.get_lots);
  update public.league_teams set purse_left = purse_left - tr.cash where id = ft.id;
  update public.league_teams set purse_left = purse_left + tr.cash where id = tt.id;
  update public.league_trades set status = 'accepted', responded_at = now() where id = tr.id;
  -- Any other pending trade involving these players is now stale.
  update public.league_trades set status = 'cancelled', responded_at = now()
   where auction_id = a.id and status = 'pending' and id <> tr.id
     and (give_lots && (tr.give_lots || tr.get_lots) or get_lots && (tr.give_lots || tr.get_lots));
  perform public._chat_system(a.id, 'system', format('Trade done: %s and %s', ft.name, tt.name));
  perform public._notify(ft.owner_id, 'system', 'Trade accepted', format('%s accepted your trade.', tt.name), '/a/' || a.id, 'trade-done:' || tr.id);
end;
$$;

create or replace function public.set_lot_end(p_lot_id uuid, p_ends_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.lots;
begin
  select * into l from public.lots where id = p_lot_id;
  if l.id is null then raise exception 'Lot not found' using errcode = 'P0001'; end if;
  perform public._assert_host(l.auction_id);
  select * into l from public.lots where id = p_lot_id for update;
  if l.status <> 'open' then raise exception 'Only open lots can be retimed' using errcode = 'P0001'; end if;
  if p_ends_at < now() + interval '5 seconds' or p_ends_at > now() + interval '30 days' then
    raise exception 'Pick a time between 5 seconds and 30 days from now' using errcode = 'P0001';
  end if;
  update public.lots set ends_at = p_ends_at where id = p_lot_id;
end;
$$;

create or replace function public.reopen_lot(p_lot_id uuid, p_minutes int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.lots;
  a public.auctions;
begin
  select * into l from public.lots where id = p_lot_id;
  if l.id is null then raise exception 'Lot not found' using errcode = 'P0001'; end if;
  a := public._assert_host(l.auction_id);
  select * into l from public.lots where id = p_lot_id for update;
  if a.mode = 'league' then raise exception 'Use the league controls to requeue players' using errcode = 'P0001'; end if;
  if a.status not in ('live', 'paused') then raise exception 'Reopen lots while the auction is running' using errcode = 'P0001'; end if;
  if l.status not in ('unsold', 'withdrawn') then raise exception 'Only unsold or withdrawn lots can be reopened' using errcode = 'P0001'; end if;
  if p_minutes not between 1 and 1440 then raise exception 'Reopen for 1 to 1440 minutes' using errcode = 'P0001'; end if;
  update public.lots set status = 'open', opens_at = now(), ends_at = now() + make_interval(mins => p_minutes) where id = p_lot_id;
end;
$$;

create or replace function public.respond_offer(p_offer_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o    public.lot_offers;
  l    public.lots;
  a    public.auctions;
  name text;
  rec  record;
begin
  select * into o from public.lot_offers where id = p_offer_id;
  if o.id is null then
    raise exception 'Offer not found' using errcode = 'P0001';
  end if;
  select * into l from public.lots where id = o.lot_id;
  a := public._assert_host(l.auction_id);
  select * into l from public.lots where id = o.lot_id for update;
  select * into o from public.lot_offers where id = p_offer_id;
  if o.status <> 'pending' then
    raise exception 'This offer is no longer pending' using errcode = 'P0001';
  end if;

  if not p_accept then
    update public.lot_offers set status = 'declined', responded_at = now() where id = o.id;
    perform public._notify(o.bidder_id, 'system', format('Offer declined on "%s"', l.title),
      format('Your offer of %s was declined. You can make a new one.', public.format_money(o.amount, a.settings)),
      '/a/' || a.id, 'offer-declined:' || o.id);
    return;
  end if;

  if a.status <> 'live' or l.status <> 'open' then
    raise exception 'The lot must be open to accept an offer' using errcode = 'P0001';
  end if;
  update public.lot_offers set status = 'accepted', responded_at = now() where id = o.id;
  for rec in
    update public.lot_offers set status = 'declined', responded_at = now()
     where lot_id = l.id and status = 'pending'
    returning id, bidder_id
  loop
    perform public._notify(rec.bidder_id, 'system', format('"%s" sold to another offer', l.title), '', '/a/' || a.id, 'offer-declined:' || rec.id);
  end loop;

  insert into public.bids (lot_id, bidder_id, amount, is_auto) values (l.id, o.bidder_id, o.amount, false);
  update public.lots
     set current_bid = o.amount, current_winner_id = o.bidder_id, reserve_met = true,
         status = 'sold', ends_at = least(coalesce(ends_at, now()), now())
   where id = l.id;
  select p.display_name into name from public.profiles p where p.id = o.bidder_id;
  perform public._chat_system(a.id, 'system',
    format('SOLD: "%s" to %s at %s (offer accepted)', l.title, name, public.format_money(o.amount, a.settings)));
  perform public._end_auction_if_done(a.id);
end;
$$;

create or replace function public.league_retain(p_lot_id uuid, p_team_id uuid, p_price numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.lots;
  a public.auctions;
  t public.league_teams;
  n int;
begin
  select * into l from public.lots where id = p_lot_id;
  if l.id is null then
    raise exception 'Player not found' using errcode = 'P0001';
  end if;
  a := public._assert_host(l.auction_id);
  select * into l from public.lots where id = p_lot_id for update;
  if a.mode <> 'league' then
    raise exception 'This is not a league auction' using errcode = 'P0001';
  end if;
  if a.status not in ('draft', 'scheduled') then
    raise exception 'Retain players before the league starts' using errcode = 'P0001';
  end if;
  if l.status <> 'pending' then
    raise exception 'This player is already taken' using errcode = 'P0001';
  end if;
  select * into t from public.league_teams where id = p_team_id and auction_id = a.id for update;
  if t.id is null then
    raise exception 'Team not found' using errcode = 'P0001';
  end if;
  p_price := round(coalesce(p_price, 0), 2);
  if p_price < 0 or p_price > t.purse_left then
    raise exception 'Not enough purse: % left', public.format_money(t.purse_left, a.settings) using errcode = 'P0001';
  end if;
  select count(*) into n from public.lots x where x.winner_team_id = t.id and x.retained;
  if n >= public.league_setting(a.settings, 'retain_max', 4) then
    raise exception 'This team has used all its retentions' using errcode = 'P0001';
  end if;
  select count(*) into n from public.lots x where x.winner_team_id = t.id and x.status = 'sold';
  if n >= public.league_setting(a.settings, 'squad_max', 25) then
    raise exception 'This squad is full' using errcode = 'P0001';
  end if;

  update public.league_teams set purse_left = purse_left - p_price where id = t.id;
  update public.lots
     set status = 'sold', retained = true, winner_team_id = t.id, current_winner_id = t.owner_id,
         current_bid = p_price, reserve_met = true, ends_at = now()
   where id = l.id;
end;
$$;

create or replace function public.league_unretain(p_lot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.lots;
  a public.auctions;
begin
  select * into l from public.lots where id = p_lot_id;
  if l.id is null then
    raise exception 'Player not found' using errcode = 'P0001';
  end if;
  a := public._assert_host(l.auction_id);
  select * into l from public.lots where id = p_lot_id for update;
  if a.status not in ('draft', 'scheduled') or not l.retained then
    raise exception 'Only retained players can be released before the league starts' using errcode = 'P0001';
  end if;
  update public.league_teams set purse_left = purse_left + coalesce(l.current_bid, 0) where id = l.winner_team_id;
  update public.lots
     set status = 'pending', retained = false, winner_team_id = null, current_winner_id = null,
         current_bid = null, ends_at = null
   where id = l.id;
end;
$$;

-- Lock order everywhere: auction row first (FOR NO KEY UPDATE), then lots.
-- The scheduler now works one auction at a time and skips auctions a host is
-- busy with; before, it locked due lots across all auctions and then updated
-- auction rows, which could deadlock with a host action.
create or replace function public.run_auction_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  lot record;
begin
  for rec in
    select id from public.auctions
     where status = 'scheduled' and starts_at <= now()
     for no key update skip locked
  loop
    perform public._start_auction(rec.id);
  end loop;

  for rec in
    select a.id, a.mode from public.auctions a
     where a.status = 'live'
       and (a.mode = 'league'
            or exists (select 1 from public.lots l where l.auction_id = a.id and l.status = 'open' and l.ends_at <= now())
            or not exists (select 1 from public.lots l where l.auction_id = a.id and l.status in ('pending', 'open')))
     for no key update skip locked
  loop
    for lot in
      select id from public.lots
       where auction_id = rec.id and status = 'open' and ends_at <= now()
       order by position
       for update skip locked
    loop
      perform public._close_lot(lot.id);
    end loop;
    if rec.mode = 'league' then
      perform public._league_open_next(rec.id);
    end if;
    perform public._end_auction_if_done(rec.id);
  end loop;
end;
$$;
revoke execute on function public.run_auction_jobs() from public, anon, authenticated;

-- Called by every viewer when the timer ends: lock the auction first, so
-- concurrent ticks queue up and only the first one acts.
create or replace function public.league_tick(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
begin
  perform 1 from public.auctions
   where id = p_auction_id and mode = 'league' and status = 'live'
   for no key update;
  if not found then
    return;
  end if;
  for rec in
    select id from public.lots
     where auction_id = p_auction_id and status = 'open' and ends_at <= now()
     for update skip locked
  loop
    perform public._close_lot(rec.id);
  end loop;
  perform public._league_open_next(p_auction_id);
end;
$$;
grant execute on function public.league_tick(uuid) to anon, authenticated;

create or replace function public.league_rtm(p_lot_id uuid, p_match boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  l   public.lots;
  a   public.auctions;
  rt  public.league_teams;
begin
  -- Auction first (league_rtm ends in _league_open_next, which locks it).
  perform 1 from public.auctions a join public.lots x on x.auction_id = a.id
   where x.id = p_lot_id for no key update of a;
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null or not l.rtm_offered or l.status <> 'open' then
    raise exception 'No right to match is waiting on this player' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = l.auction_id;
  select * into rt from public.league_teams where id = l.rtm_team_id and owner_id = uid for update;
  if rt.id is null then
    raise exception 'Only the previous team can use the right to match' using errcode = 'P0001';
  end if;

  if p_match then
    if rt.purse_left < l.current_bid then
      raise exception 'Not enough purse to match' using errcode = 'P0001';
    end if;
    insert into public.bids (lot_id, bidder_id, amount, is_auto, team_id) values (l.id, uid, l.current_bid, false, rt.id);
    update public.league_teams set rtm_used = rtm_used + 1 where id = rt.id;
    update public.lots set winner_team_id = rt.id, current_winner_id = uid where id = l.id;
    perform public._chat_system(a.id, 'system', format('%s matched and keeps "%s"', rt.name, l.title));
  end if;
  perform public._close_lot(l.id);
  perform public._league_open_next(a.id);
end;
$$;

create or replace function public.dutch_accept(p_lot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  l     public.lots;
  a     public.auctions;
  price numeric;
  name  text;
begin
  -- Auction first: buying the last lot ends the auction (an auction row update).
  perform 1 from public.auctions a join public.lots x on x.auction_id = a.id
   where x.id = p_lot_id for no key update of a;
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then
    raise exception 'Lot not found' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = l.auction_id;
  perform public._assert_can_bid(uid, l, a);
  if l.sale_type <> 'dutch' then
    raise exception 'This lot is not a Dutch lot' using errcode = 'P0001';
  end if;

  price := public._dutch_price(l, a);
  insert into public.bids (lot_id, bidder_id, amount, is_auto) values (p_lot_id, uid, price, false);
  update public.lots
     set current_bid = price, current_winner_id = uid, bid_count = bid_count + 1,
         reserve_met = true, status = 'sold', ends_at = now()
   where id = p_lot_id;

  select p.display_name into name from public.profiles p where p.id = uid;
  perform public._chat_system(a.id, 'system',
    format('SOLD: "%s" to %s at %s (Dutch)', l.title, name, public.format_money(price, a.settings)));
  perform public._end_auction_if_done(a.id);
  return jsonb_build_object('status', 'sold', 'current_bid', price, 'winner_id', uid);
end;
$$;
