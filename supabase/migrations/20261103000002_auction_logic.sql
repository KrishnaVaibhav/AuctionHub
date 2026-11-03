-- AuctionHub business logic: bidding (with proxy bids + anti-sniping), buy-now,
-- host controls, and the scheduler job that starts/closes auctions.
-- All functions are SECURITY DEFINER with an empty search_path and check the
-- caller themselves. Row locks (SELECT ... FOR UPDATE) serialize bids per lot.

-- ---------------------------------------------------------------------------
-- Pricing helpers
-- ---------------------------------------------------------------------------
-- settings.increments = [[threshold, increment], ...]; the highest threshold
-- <= amount applies.
create or replace function public.bid_increment(p_amount numeric, p_settings jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select (e ->> 1)::numeric
    from jsonb_array_elements(
      coalesce(
        p_settings -> 'increments',
        '[[0,10],[1000,50],[5000,100],[10000,500],[50000,1000],[100000,5000]]'::jsonb
      )
    ) as e
    where (e ->> 0)::numeric <= coalesce(p_amount, 0)
    order by (e ->> 0)::numeric desc
    limit 1
  ), 1);
$$;

create or replace function public.min_next_bid(p_lot_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when l.current_bid is null then l.start_price
           else l.current_bid + public.bid_increment(l.current_bid, a.settings)
         end
  from public.lots l
  join public.auctions a on a.id = l.auction_id
  where l.id = p_lot_id;
$$;

create or replace function public.format_money(p_amount numeric, p_settings jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_settings ->> 'currency', 'INR') || ' ' || to_char(p_amount, 'FM999,999,999,990.00');
$$;

-- Internal: post a system/bid line to the auction chat.
create or replace function public._chat_system(p_auction_id uuid, p_kind public.chat_kind, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.chat_messages (auction_id, user_id, kind, body)
  values (p_auction_id, null, p_kind, left(p_body, 500));
$$;

-- Internal: shared pre-checks for bidding / buying.
create or replace function public._assert_can_bid(p_uid uuid, l public.lots, a public.auctions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_uid is null then
    raise exception 'Sign in to bid' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_uid and p.banned_until > now()) then
    raise exception 'Your account is suspended' using errcode = 'P0001';
  end if;
  if a.host_id = p_uid then
    raise exception 'Hosts cannot bid in their own auction' using errcode = 'P0001';
  end if;
  if a.status <> 'live' then
    raise exception 'Auction is not live' using errcode = 'P0001';
  end if;
  if l.status <> 'open' or l.ends_at is null or l.ends_at <= now() then
    raise exception 'Bidding is closed for this lot' using errcode = 'P0001';
  end if;
  if l.opens_at is not null and l.opens_at > now() then
    raise exception 'Bidding has not opened for this lot' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- place_bid: the core bid engine
--   p_amount      visible bid amount (must be >= min_next_bid)
--   p_max_amount  optional proxy ceiling; system auto-bids up to it
-- Returns { status: leading | outbid | max_raised, current_bid, winner_id,
--           ends_at, min_next_bid }
-- ---------------------------------------------------------------------------
create or replace function public.place_bid(p_lot_id uuid, p_amount numeric, p_max_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid          uuid := auth.uid();
  l            public.lots;
  a            public.auctions;
  min_bid      numeric;
  my_max       numeric;
  leader_max   numeric;
  new_price    numeric;
  winner       uuid;
  outcome      text;
  inserted     int := 0;
  reserve      numeric;
  window_s     int;
  new_ends_at  timestamptz;
  recent       int;
  winner_name  text;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then
    raise exception 'Lot not found' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = l.auction_id;

  perform public._assert_can_bid(uid, l, a);

  if p_amount is null or p_amount <= 0 or p_amount >= 1e10
     or (p_max_amount is not null and (p_max_amount <= 0 or p_max_amount >= 1e10)) then
    raise exception 'Invalid bid amount' using errcode = 'P0001';
  end if;

  select count(*) into recent from public.bids b
    where b.lot_id = p_lot_id and b.bidder_id = uid and not b.is_auto
      and b.created_at > now() - interval '10 seconds';
  if recent >= 5 then
    raise exception 'Too many bids. Wait a few seconds.' using errcode = 'P0001';
  end if;

  p_amount := round(p_amount, 2);
  my_max := greatest(p_amount, coalesce(round(p_max_amount, 2), p_amount));

  -- Current leader can only raise their own proxy ceiling.
  if l.current_winner_id = uid then
    select pb.max_amount into leader_max from public.proxy_bids pb
      where pb.lot_id = p_lot_id and pb.bidder_id = uid;
    if my_max <= coalesce(leader_max, l.current_bid) then
      raise exception 'You are already the highest bidder' using errcode = 'P0001';
    end if;
    update public.proxy_bids set max_amount = my_max, updated_at = now()
      where lot_id = p_lot_id and bidder_id = uid;
    return jsonb_build_object(
      'status', 'max_raised', 'current_bid', l.current_bid, 'winner_id', uid,
      'ends_at', l.ends_at, 'max_amount', my_max,
      'min_next_bid', l.current_bid + public.bid_increment(l.current_bid, a.settings));
  end if;

  min_bid := case
               when l.current_bid is null then l.start_price
               else l.current_bid + public.bid_increment(l.current_bid, a.settings)
             end;
  if p_amount < min_bid then
    raise exception 'Minimum bid is %', public.format_money(min_bid, a.settings) using errcode = 'P0001';
  end if;

  insert into public.proxy_bids (lot_id, bidder_id, max_amount)
  values (p_lot_id, uid, my_max)
  on conflict (lot_id, bidder_id) do update
    set max_amount = excluded.max_amount, updated_at = now();

  if l.current_winner_id is null then
    -- First bid on the lot.
    new_price := p_amount;
    winner := uid;
    outcome := 'leading';
    insert into public.bids (lot_id, bidder_id, amount, is_auto) values (p_lot_id, uid, new_price, false);
    inserted := 1;
  else
    select pb.max_amount into leader_max from public.proxy_bids pb
      where pb.lot_id = p_lot_id and pb.bidder_id = l.current_winner_id;
    leader_max := greatest(coalesce(leader_max, l.current_bid), l.current_bid);

    if my_max > leader_max then
      -- Challenger takes the lead at the lowest price that beats the leader's ceiling.
      if leader_max > l.current_bid and p_amount <= leader_max then
        insert into public.bids (lot_id, bidder_id, amount, is_auto)
          values (p_lot_id, l.current_winner_id, leader_max, true);
        inserted := inserted + 1;
      end if;
      new_price := greatest(p_amount, least(my_max, leader_max + public.bid_increment(leader_max, a.settings)));
      insert into public.bids (lot_id, bidder_id, amount, is_auto)
        values (p_lot_id, uid, new_price, new_price > p_amount);
      inserted := inserted + 1;
      winner := uid;
      outcome := 'leading';
    else
      -- Leader's proxy defends. Ties go to the earlier ceiling (the leader).
      insert into public.bids (lot_id, bidder_id, amount, is_auto) values (p_lot_id, uid, p_amount, false);
      inserted := inserted + 1;
      if my_max > p_amount then
        insert into public.bids (lot_id, bidder_id, amount, is_auto) values (p_lot_id, uid, my_max, true);
        inserted := inserted + 1;
      end if;
      new_price := least(leader_max, my_max + public.bid_increment(my_max, a.settings));
      insert into public.bids (lot_id, bidder_id, amount, is_auto)
        values (p_lot_id, l.current_winner_id, new_price, true);
      inserted := inserted + 1;
      winner := l.current_winner_id;
      outcome := 'outbid';
    end if;
  end if;

  select r.reserve_price into reserve from public.lot_reserves r where r.lot_id = p_lot_id;

  -- Anti-sniping: a bid inside the final window pushes the close out.
  window_s := coalesce((a.settings ->> 'anti_snipe_seconds')::int, 30);
  new_ends_at := l.ends_at;
  if window_s > 0 and l.ends_at - now() < make_interval(secs => window_s) then
    new_ends_at := now() + make_interval(secs => window_s);
  end if;

  update public.lots
     set current_bid = new_price,
         current_winner_id = winner,
         bid_count = bid_count + inserted,
         reserve_met = (reserve is null or new_price >= reserve),
         ends_at = new_ends_at
   where id = p_lot_id;

  select p.display_name into winner_name from public.profiles p where p.id = winner;
  perform public._chat_system(a.id, 'bid',
    format('%s leads "%s" at %s', winner_name, l.title, public.format_money(new_price, a.settings)));

  return jsonb_build_object(
    'status', outcome, 'current_bid', new_price, 'winner_id', winner,
    'ends_at', new_ends_at,
    'min_next_bid', new_price + public.bid_increment(new_price, a.settings));
end;
$$;

-- ---------------------------------------------------------------------------
-- buy_now: available until the first bid
-- ---------------------------------------------------------------------------
create or replace function public.buy_now(p_lot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  l    public.lots;
  a    public.auctions;
  name text;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then
    raise exception 'Lot not found' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = l.auction_id;
  perform public._assert_can_bid(uid, l, a);

  if l.buy_now_price is null then
    raise exception 'Buy now is not available for this lot' using errcode = 'P0001';
  end if;
  if l.bid_count > 0 then
    raise exception 'Buy now ended when bidding started' using errcode = 'P0001';
  end if;

  insert into public.bids (lot_id, bidder_id, amount, is_auto) values (p_lot_id, uid, l.buy_now_price, false);
  update public.lots
     set current_bid = l.buy_now_price, current_winner_id = uid, bid_count = bid_count + 1,
         reserve_met = true, status = 'sold', ends_at = now()
   where id = p_lot_id;

  select p.display_name into name from public.profiles p where p.id = uid;
  perform public._chat_system(a.id, 'system',
    format('SOLD: "%s" to %s via Buy Now at %s', l.title, name, public.format_money(l.buy_now_price, a.settings)));

  return jsonb_build_object('status', 'sold', 'current_bid', l.buy_now_price, 'winner_id', uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal lifecycle helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create or replace function public._close_lot(p_lot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l    public.lots;
  a    public.auctions;
  name text;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null or l.status <> 'open' then
    return;
  end if;
  select * into a from public.auctions where id = l.auction_id;

  if l.current_winner_id is not null and l.reserve_met then
    update public.lots set status = 'sold', ends_at = least(ends_at, now()) where id = l.id;
    select p.display_name into name from public.profiles p where p.id = l.current_winner_id;
    perform public._chat_system(a.id, 'system',
      format('SOLD: "%s" to %s at %s', l.title, name, public.format_money(l.current_bid, a.settings)));
  else
    update public.lots set status = 'unsold', ends_at = least(ends_at, now()) where id = l.id;
    perform public._chat_system(a.id, 'system',
      format('"%s" closed unsold%s', l.title,
             case when l.current_winner_id is not null then ' (reserve not met)' else '' end));
  end if;
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
begin
  select * into a from public.auctions where id = p_auction_id for update;
  if a.id is null or a.status not in ('draft', 'scheduled') then
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

create or replace function public._end_auction_if_done(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.lots where auction_id = p_auction_id and status in ('pending', 'open')) then
    update public.auctions set status = 'ended', ends_at = least(coalesce(ends_at, now()), now())
     where id = p_auction_id and status in ('live', 'paused');
    if found then
      perform public._chat_system(p_auction_id, 'system', 'The auction has ended. Thanks for bidding!');
    end if;
  end if;
end;
$$;

create or replace function public._assert_host(p_auction_id uuid)
returns public.auctions
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions;
begin
  select * into a from public.auctions where id = p_auction_id for update;
  if a.id is null then
    raise exception 'Auction not found' using errcode = 'P0001';
  end if;
  if a.host_id is distinct from auth.uid() then
    raise exception 'Only the host can do this' using errcode = 'P0001';
  end if;
  return a;
end;
$$;

-- ---------------------------------------------------------------------------
-- Host controls (callable by authenticated users; host is checked inside)
-- ---------------------------------------------------------------------------
create or replace function public.schedule_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions := public._assert_host(p_auction_id);
begin
  if a.status <> 'draft' then
    raise exception 'Only draft auctions can be scheduled' using errcode = 'P0001';
  end if;
  if a.starts_at is null or a.starts_at <= now() then
    raise exception 'Set a start time in the future' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.lots where auction_id = p_auction_id) then
    raise exception 'Add at least one lot first' using errcode = 'P0001';
  end if;
  update public.auctions set status = 'scheduled' where id = p_auction_id;
end;
$$;

create or replace function public.unschedule_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions := public._assert_host(p_auction_id);
begin
  if a.status <> 'scheduled' then
    raise exception 'Auction is not scheduled' using errcode = 'P0001';
  end if;
  update public.auctions set status = 'draft' where id = p_auction_id;
end;
$$;

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

create or replace function public.pause_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions := public._assert_host(p_auction_id);
begin
  if a.status <> 'live' then
    raise exception 'Auction is not live' using errcode = 'P0001';
  end if;
  update public.auctions set status = 'paused', paused_at = now() where id = p_auction_id;
  perform public._chat_system(p_auction_id, 'system', 'The host paused the auction. Timers are frozen.');
end;
$$;

create or replace function public.resume_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       public.auctions := public._assert_host(p_auction_id);
  paused  interval;
begin
  if a.status <> 'paused' then
    raise exception 'Auction is not paused' using errcode = 'P0001';
  end if;
  paused := now() - coalesce(a.paused_at, now());
  update public.lots set ends_at = ends_at + paused where auction_id = p_auction_id and status = 'open';
  update public.auctions
     set status = 'live', paused_at = null, ends_at = ends_at + paused
   where id = p_auction_id;
  perform public._chat_system(p_auction_id, 'system', 'The auction has resumed.');
end;
$$;

-- "Going once, going twice, sold": host closes an open lot now.
create or replace function public.close_lot_now(p_lot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  aid uuid;
begin
  select auction_id into aid from public.lots where id = p_lot_id;
  perform public._assert_host(aid);
  if not exists (select 1 from public.lots where id = p_lot_id and status = 'open') then
    raise exception 'Lot is not open' using errcode = 'P0001';
  end if;
  perform public._close_lot(p_lot_id);
  perform public._end_auction_if_done(aid);
end;
$$;

create or replace function public.withdraw_lot(p_lot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.lots;
begin
  select * into l from public.lots where id = p_lot_id;
  perform public._assert_host(l.auction_id);
  if l.status not in ('pending', 'open') then
    raise exception 'Lot already closed' using errcode = 'P0001';
  end if;
  update public.lots set status = 'withdrawn', ends_at = least(coalesce(ends_at, now()), now()) where id = p_lot_id;
  perform public._chat_system(l.auction_id, 'system', format('"%s" was withdrawn by the host', l.title));
  perform public._end_auction_if_done(l.auction_id);
end;
$$;

create or replace function public.end_auction_now(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a     public.auctions := public._assert_host(p_auction_id);
  lot_id uuid;
begin
  if a.status not in ('live', 'paused') then
    raise exception 'Auction is not running' using errcode = 'P0001';
  end if;
  for lot_id in select id from public.lots where auction_id = p_auction_id and status = 'open' order by position loop
    perform public._close_lot(lot_id);
  end loop;
  update public.lots set status = 'withdrawn' where auction_id = p_auction_id and status = 'pending';
  perform public._end_auction_if_done(p_auction_id);
end;
$$;

create or replace function public.cancel_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions := public._assert_host(p_auction_id);
begin
  if a.status in ('ended', 'cancelled') then
    raise exception 'Auction already finished' using errcode = 'P0001';
  end if;
  update public.lots set status = 'withdrawn' where auction_id = p_auction_id and status in ('pending', 'open');
  update public.auctions set status = 'cancelled' where id = p_auction_id;
  perform public._chat_system(p_auction_id, 'system', 'The host cancelled this auction.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Scheduler job: start due auctions, close due lots, end finished auctions.
-- ---------------------------------------------------------------------------
create or replace function public.run_auction_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
begin
  for rec in
    select id from public.auctions
     where status = 'scheduled' and starts_at <= now()
     for update skip locked
  loop
    perform public._start_auction(rec.id);
  end loop;

  for rec in
    select l.id, l.auction_id from public.lots l
      join public.auctions a on a.id = l.auction_id
     where l.status = 'open' and l.ends_at <= now() and a.status = 'live'
     for update of l skip locked
  loop
    perform public._close_lot(rec.id);
  end loop;

  for rec in select id from public.auctions where status = 'live' loop
    perform public._end_auction_if_done(rec.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: Supabase grants EXECUTE on new public functions to anon and
-- authenticated by default. Lock everything down, then allow the public API.
-- ---------------------------------------------------------------------------
revoke execute on function
  public._chat_system(uuid, public.chat_kind, text),
  public._assert_can_bid(uuid, public.lots, public.auctions),
  public._close_lot(uuid),
  public._start_auction(uuid),
  public._end_auction_if_done(uuid),
  public._assert_host(uuid),
  public.run_auction_jobs(),
  public.handle_new_user(),
  public.chat_guard()
from public, anon, authenticated;

revoke execute on function
  public.place_bid(uuid, numeric, numeric),
  public.buy_now(uuid),
  public.schedule_auction(uuid),
  public.unschedule_auction(uuid),
  public.start_auction(uuid),
  public.pause_auction(uuid),
  public.resume_auction(uuid),
  public.close_lot_now(uuid),
  public.withdraw_lot(uuid),
  public.end_auction_now(uuid),
  public.cancel_auction(uuid)
from public, anon;

grant execute on function
  public.place_bid(uuid, numeric, numeric),
  public.buy_now(uuid),
  public.schedule_auction(uuid),
  public.unschedule_auction(uuid),
  public.start_auction(uuid),
  public.pause_auction(uuid),
  public.resume_auction(uuid),
  public.close_lot_now(uuid),
  public.withdraw_lot(uuid),
  public.end_auction_now(uuid),
  public.cancel_auction(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- pg_cron: run the scheduler every 15 seconds
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

select cron.schedule('auction-jobs', '15 seconds', $$select public.run_auction_jobs()$$);

-- ---------------------------------------------------------------------------
-- Server clock for client countdown sync
-- ---------------------------------------------------------------------------
create or replace function public.server_time()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now();
$$;
