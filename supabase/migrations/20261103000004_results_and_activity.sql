-- Results for hosts (who won what, with contact email) and per-user activity.

-- Host-only: every lot of an auction with its outcome and the winner's contact.
create or replace function public.auction_results(p_auction_id uuid)
returns table (
  lot_id           uuid,
  "position"       int,
  title            text,
  status           public.lot_status,
  final_price      numeric,
  bid_count        int,
  reserve_met      boolean,
  winner_id        uuid,
  winner_name      text,
  winner_username  text,
  winner_email     text,
  closed_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_auction_host(p_auction_id) then
    raise exception 'Only the host can see results' using errcode = 'P0001';
  end if;
  return query
    select l.id, l.position, l.title, l.status, l.current_bid, l.bid_count, l.reserve_met,
           l.current_winner_id, p.display_name, p.username,
           case when l.status = 'sold' then u.email::text end,
           case when l.status in ('sold', 'unsold', 'withdrawn') then l.ends_at end
      from public.lots l
      left join public.profiles p on p.id = l.current_winner_id
      left join auth.users u on u.id = l.current_winner_id
     where l.auction_id = p_auction_id
     order by l.position, l.created_at;
end;
$$;

-- Caller's lots: everything they bid on, with their top bid and standing.
create or replace function public.my_lots()
returns table (
  lot_id          uuid,
  auction_id      uuid,
  auction_title   text,
  auction_status  public.auction_status,
  currency        text,
  host_id         uuid,
  title           text,
  status          public.lot_status,
  current_bid     numeric,
  my_top_bid      numeric,
  my_max          numeric,
  is_leader       boolean,
  ends_at         timestamptz,
  last_bid_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select b.lot_id, max(b.amount) as top, max(b.created_at) as last_at
      from public.bids b
     where b.bidder_id = (select auth.uid())
     group by b.lot_id
  )
  select l.id, a.id, a.title, a.status, coalesce(a.settings ->> 'currency', 'INR'), a.host_id,
         l.title, l.status, l.current_bid, m.top, pb.max_amount,
         l.current_winner_id = (select auth.uid()), l.ends_at, m.last_at
    from mine m
    join public.lots l on l.id = m.lot_id
    join public.auctions a on a.id = l.auction_id
    left join public.proxy_bids pb on pb.lot_id = l.id and pb.bidder_id = (select auth.uid())
   order by m.last_at desc
   limit 500;
$$;

revoke execute on function public.auction_results(uuid), public.my_lots() from public, anon;
grant execute on function public.auction_results(uuid), public.my_lots() to authenticated;

-- Speeds up "who won what" lookups for a user.
create index if not exists lots_winner_idx on public.lots (current_winner_id) where current_winner_id is not null;
