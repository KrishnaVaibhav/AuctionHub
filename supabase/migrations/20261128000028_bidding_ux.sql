-- Bidding UX fixes.
--
-- 1. close_due_lots: when a lot's clock reaches zero, any viewer's page asks
--    the server to close it, so the room shows "Sold" at once instead of
--    waiting for the next scheduler run (every 15 seconds). It does exactly
--    what the scheduler does for one auction: only lots whose time is up.
-- 2. min_next_bid: a lot that starts at 0 asked for a first bid of 0, which
--    place_bid refuses as invalid; with custom bids off nobody could bid at
--    all. The first bid on a free-start lot is now one increment.
-- 3. Notifications about one lot (outbid, closing soon) link to that lot.

-- ---------------------------------------------------------------------------
-- 1. Close expired lots on demand
-- ---------------------------------------------------------------------------
create or replace function public.close_due_lots(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec    record;
  closed int := 0;
begin
  -- Same lock order as the scheduler: the auction first, then its lots.
  -- Leagues run their own clock (league_tick).
  perform 1 from public.auctions
   where id = p_auction_id and mode <> 'league' and status = 'live'
   for no key update;
  if not found then
    return;
  end if;
  for rec in
    select id from public.lots
     where auction_id = p_auction_id and status = 'open' and ends_at <= now()
     order by position
     for update skip locked
  loop
    perform public._close_lot(rec.id);
    closed := closed + 1;
  end loop;
  if closed > 0 then
    perform public._end_auction_if_done(p_auction_id);
  end if;
end;
$$;
revoke execute on function public.close_due_lots(uuid) from public;
grant execute on function public.close_due_lots(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. First bid on a lot that starts at 0
-- ---------------------------------------------------------------------------
create or replace function public.min_next_bid(p_lot_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when l.current_bid is not null then l.current_bid + public.bid_increment(l.current_bid, a.settings)
           when l.start_price > 0 then l.start_price
           else public.bid_increment(0, a.settings)
         end
  from public.lots l
  join public.auctions a on a.id = l.auction_id
  where l.id = p_lot_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Lot links in notifications (same as before, plus ?lot=)
-- ---------------------------------------------------------------------------
create or replace function public.notify_lot_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions;
begin
  select * into a from public.auctions where id = new.auction_id;

  if new.status = 'open' and old.current_winner_id is not null
     and new.current_winner_id is distinct from old.current_winner_id then
    perform public._notify(old.current_winner_id, 'outbid', format('Outbid on "%s"', new.title),
      format('Current bid %s. Bid again before it closes.', public.format_money(new.current_bid, a.settings)),
      '/a/' || a.id || '?lot=' || new.id);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'sold' and new.current_winner_id is not null then
      perform public._notify(new.current_winner_id, 'won', format('You won "%s"', new.title),
        format('Final price %s. Arrange payment and delivery with the host.', public.format_money(new.current_bid, a.settings)),
        case when a.mode = 'league' then '/a/' || a.id else '/me' end, 'won:' || new.id);
      perform public._notify(a.host_id, 'sold', format('"%s" sold', new.title),
        format('Sold for %s.', public.format_money(new.current_bid, a.settings)), '/a/' || a.id || '?tab=results', 'sold:' || new.id);
    elsif new.status = 'unsold' then
      perform public._notify(a.host_id, 'unsold', format('"%s" closed unsold', new.title), '', '/a/' || a.id || '?tab=results', 'unsold:' || new.id);
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.notify_closing_soon()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, ref)
  select w.user_id, 'closing', format('"%s" closes soon', l.title),
         format('Current bid %s. Last chance to bid.', public.format_money(coalesce(l.current_bid, l.start_price), a.settings)),
         '/a/' || a.id || '?lot=' || l.id, 'closing:' || l.id
    from public.watchlist w
    join public.lots l on l.id = w.lot_id
    join public.auctions a on a.id = l.auction_id
   where l.status = 'open' and a.status = 'live'
     and l.ends_at between now() and now() + interval '5 minutes'
     and w.user_id is distinct from l.current_winner_id
  on conflict do nothing;
$$;
