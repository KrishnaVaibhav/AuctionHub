-- Host tools: duplicate auction, per-auction analytics.

-- Copy an auction (settings, lots, reserves) into a new draft. Photos are not
-- copied, so deleting either auction can never break the other's images.
create or replace function public.duplicate_auction(p_auction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a      public.auctions := public._assert_host(p_auction_id);
  new_id uuid := gen_random_uuid();
begin
  insert into public.auctions (id, host_id, title, description, settings, cover_url, mode, visibility, category, tags)
  values (new_id, a.host_id, left(a.title || ' (copy)', 120), a.description, a.settings, a.cover_url, a.mode, a.visibility, a.category, a.tags);

  with src as (
    select l.*, gen_random_uuid() as new_lot_id from public.lots l where l.auction_id = p_auction_id
  ), ins as (
    insert into public.lots (id, auction_id, position, title, description, start_price, buy_now_price, custom_fields)
    select new_lot_id, new_id, position, title, description, start_price, buy_now_price, custom_fields from src
    returning id
  )
  insert into public.lot_reserves (lot_id, reserve_price)
  select s.new_lot_id, r.reserve_price from src s join public.lot_reserves r on r.lot_id = s.id;

  return new_id;
end;
$$;
revoke execute on function public.duplicate_auction(uuid) from public, anon;
grant execute on function public.duplicate_auction(uuid) to authenticated;

-- Host (or platform admin) analytics for one auction.
create or replace function public.auction_analytics(p_auction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_auction_host(p_auction_id) or public.is_platform_admin()) then
    raise exception 'Only the host can see analytics' using errcode = 'P0001';
  end if;
  return (
    with lots as (select * from public.lots where auction_id = p_auction_id),
         b as (select bd.* from public.bids bd join lots l on l.id = bd.lot_id)
    select jsonb_build_object(
      'lots', (select count(*) from lots),
      'lots_sold', (select count(*) from lots where status = 'sold'),
      'sold_total', (select coalesce(sum(current_bid), 0) from lots where status = 'sold'),
      'start_total', (select coalesce(sum(start_price), 0) from lots where status = 'sold'),
      'bids', (select count(*) from b),
      'manual_bids', (select count(*) from b where not is_auto),
      'unique_bidders', (select count(distinct bidder_id) from b),
      'watchers', (select count(distinct w.user_id) from public.watchlist w join lots l on l.id = w.lot_id),
      'chat_messages', (select count(*) from public.chat_messages where auction_id = p_auction_id and kind = 'text'),
      'chatters', (select count(distinct user_id) from public.chat_messages where auction_id = p_auction_id and kind = 'text'),
      'members', (select count(*) from public.auction_members where auction_id = p_auction_id),
      'per_lot', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', l.id, 'position', l.position, 'title', l.title, 'status', l.status,
                    'start', l.start_price, 'final', l.current_bid, 'bids', l.bid_count,
                    'bidders', (select count(distinct bidder_id) from b where b.lot_id = l.id),
                    'watchers', (select count(*) from public.watchlist w where w.lot_id = l.id),
                    'uplift_pct', case when l.current_bid is not null and l.start_price > 0
                                       then round((l.current_bid - l.start_price) / l.start_price * 100, 1) end
                  ) order by l.position), '[]') from lots l),
      'timeline', (select coalesce(jsonb_agg(jsonb_build_object('t', t, 'bids', n) order by t), '[]')
                     from (select date_trunc('minute', created_at) as t, count(*) as n from b group by 1) x),
      'top_bidders', (select coalesce(jsonb_agg(x order by (x ->> 'bids')::int desc), '[]') from (
                        select jsonb_build_object('name', p.display_name, 'bids', count(*),
                                 'won', (select count(*) from lots l where l.current_winner_id = b.bidder_id and l.status = 'sold')) as x
                          from b join public.profiles p on p.id = b.bidder_id
                         group by b.bidder_id, p.display_name
                         order by count(*) desc limit 10) s)
    )
  );
end;
$$;
revoke execute on function public.auction_analytics(uuid) from public, anon;
grant execute on function public.auction_analytics(uuid) to authenticated;
