-- Room bingo, checked by the server.
--
-- Before: the browser decided a line was complete and claim_bingo trusted it.
-- Now: the server deals each signed-in viewer's card, works out which squares
-- have happened from stored lots and bids, and only pays out a real line.
-- The square keys match BINGO_EVENTS in web/src/lib/fun.ts.

-- ---------------------------------------------------------------------------
-- Time extensions (anti-snipe or the host adding time) leave no other trace.
-- ---------------------------------------------------------------------------
alter table public.lots add column extensions int not null default 0;

create or replace function public.count_lot_extension()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'open' and new.status = 'open'
     and old.ends_at is not null and new.ends_at > old.ends_at then
    new.extensions := old.extensions + 1;
  end if;
  return new;
end;
$$;
create trigger lots_count_extension before update of ends_at on public.lots
  for each row execute function public.count_lot_extension();

-- ---------------------------------------------------------------------------
-- Cards: dealt once per viewer and auction, kept so they never change.
-- ---------------------------------------------------------------------------
create table public.bingo_cards (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  squares     text[] not null check (cardinality(squares) = 9),
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  primary key (user_id, auction_id)
);
alter table public.bingo_cards enable row level security;
revoke all on public.bingo_cards from anon, authenticated;
grant select on public.bingo_cards to authenticated;
create policy "bingo own read" on public.bingo_cards for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public._bingo_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['double', 'triple', 'showdown', 'extend', 'unsold', 'ten_bids',
               'opening', 'fast', 'buy_now', 'five_sold', 'big_jump', 'first_bid'];
$$;

-- Which squares have happened in this auction, from what the database recorded.
create or replace function public._bingo_hits(p_auction_id uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  with l as (
    select * from public.lots where auction_id = p_auction_id
  ),
  b as (
    select b.id, b.lot_id, b.amount, b.created_at,
           coalesce(b.team_id::text, b.bidder_id::text) as who
      from public.bids b join l on l.id = b.lot_id
  ),
  jumps as (
    select amount >= 1.5 * lag(amount) over (partition by lot_id order by id) as big
      from b
  ),
  bursts as (
    select count(*) over (order by created_at range between interval '60 seconds' preceding and current row) as n
      from b
  ),
  -- Leader sequence per lot with repeats collapsed (auto-bids re-confirm the leader).
  seq as (
    select lot_id, who, id
      from (select lot_id, who, id, lag(who) over (partition by lot_id order by id) as prev from b) x
     where prev is distinct from who
  ),
  duels as (
    select who = lead(who, 2) over w and lead(who, 1) over w = lead(who, 3) over w as duel
      from seq window w as (partition by lot_id order by id)
  )
  select coalesce(array_agg(k), '{}') from (
    select 'double' as k where exists (select 1 from l where status = 'sold' and start_price > 0 and current_bid >= 2 * start_price)
    union all select 'triple' where exists (select 1 from l where status = 'sold' and start_price > 0 and current_bid >= 3 * start_price)
    union all select 'opening' where exists (select 1 from l where status = 'sold' and current_bid = start_price)
    union all select 'buy_now' where exists (select 1 from l where status = 'sold' and buy_now_price is not null and current_bid >= buy_now_price)
    union all select 'five_sold' where (select count(*) from l where status = 'sold') >= 5
    union all select 'unsold' where exists (select 1 from l where status = 'unsold')
    union all select 'ten_bids' where exists (select 1 from l where bid_count >= 10)
    union all select 'first_bid' where exists (select 1 from l where bid_count > 0)
    union all select 'extend' where exists (select 1 from l where extensions > 0)
    union all select 'fast' where exists (select 1 from bursts where n >= 5)
    union all select 'big_jump' where exists (select 1 from jumps where big)
    union all select 'showdown' where exists (select 1 from duels where duel)
  ) h;
$$;
revoke execute on function public._bingo_hits(uuid) from public, anon, authenticated;

create or replace function public._bingo_line(p_card text[], p_hits text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  lines int[] := '{{1,2,3},{4,5,6},{7,8,9},{1,4,7},{2,5,8},{3,6,9},{1,5,9},{3,5,7}}';
  ln int[];
begin
  foreach ln slice 1 in array lines loop
    if p_card[ln[1]] = any (p_hits) and p_card[ln[2]] = any (p_hits) and p_card[ln[3]] = any (p_hits) then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- The viewer's card (dealt on first call), the squares hit, and whether they claimed.
-- Guests get the hits only.
create or replace function public.bingo_state(p_auction_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  c public.bingo_cards;
  hits text[];
begin
  if not public.auction_visible(p_auction_id) then
    raise exception 'Auction not found' using errcode = 'P0001';
  end if;
  hits := public._bingo_hits(p_auction_id);
  if uid is null then
    return jsonb_build_object('card', null, 'hits', to_jsonb(hits), 'claimed', false, 'line', false);
  end if;
  select * into c from public.bingo_cards where user_id = uid and auction_id = p_auction_id;
  if c.user_id is null then
    insert into public.bingo_cards (user_id, auction_id, squares)
    select uid, p_auction_id, (select array_agg(k order by random()) from unnest(public._bingo_keys()) k)[1:9]
    on conflict do nothing;
    select * into c from public.bingo_cards where user_id = uid and auction_id = p_auction_id;
  end if;
  return jsonb_build_object(
    'card', to_jsonb(c.squares),
    'hits', to_jsonb(hits),
    'claimed', c.claimed_at is not null,
    'line', public._bingo_line(c.squares, hits)
  );
end;
$$;
revoke execute on function public.bingo_state(uuid) from public;
grant execute on function public.bingo_state(uuid) to anon, authenticated;

-- Pays out only when the server sees a complete line on the viewer's own card.
create or replace function public.claim_bingo(p_auction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.auctions;
  c public.bingo_cards;
begin
  select * into a from public.auctions where id = p_auction_id;
  if a.id is null or not public.auction_visible(p_auction_id) or a.status not in ('live', 'paused', 'ended') then
    raise exception 'Auction not found' using errcode = 'P0001';
  end if;
  if not public._fun_on(a.settings, 'bingo') then raise exception 'The host has turned bingo off' using errcode = 'P0001'; end if;
  select * into c from public.bingo_cards where user_id = auth.uid() and auction_id = p_auction_id for update;
  if c.user_id is null then raise exception 'No bingo card yet' using errcode = 'P0001'; end if;
  if c.claimed_at is not null then return; end if;
  if not public._bingo_line(c.squares, public._bingo_hits(p_auction_id)) then
    raise exception 'No complete line yet' using errcode = 'P0001';
  end if;
  update public.bingo_cards set claimed_at = now() where user_id = c.user_id and auction_id = p_auction_id;
  perform public._award(auth.uid(), 'bingo', p_auction_id::text);
  perform public._grant_xp(auth.uid(), 'bingo:' || p_auction_id::text, 25, 25);
end;
$$;
revoke execute on function public.claim_bingo(uuid) from public, anon;
grant execute on function public.claim_bingo(uuid) to authenticated;
