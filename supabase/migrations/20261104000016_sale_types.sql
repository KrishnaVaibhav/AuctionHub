-- Sale types per lot:
--   english  ascending bids with proxy auto-bids (the original engine, unchanged)
--   dutch    price drops by a fixed step on a timer; the first person to accept buys
--   sealed   hidden bids, raise-only; revealed at close, highest wins (earliest on a tie)
--   offer    bidders make offers; the host accepts or declines; buy now still allowed

alter table public.lots
  add column sale_type text not null default 'english'
    check (sale_type in ('english', 'dutch', 'sealed', 'offer')),
  add column sale_settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sale_settings) = 'object' and pg_column_size(sale_settings) < 2000);
grant insert (sale_type, sale_settings), update (sale_type, sale_settings) on public.lots to authenticated;

create or replace function public.guard_sale_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m text;
  s jsonb := new.sale_settings;
begin
  if tg_op = 'UPDATE' and old.status <> 'pending'
     and (new.sale_type is distinct from old.sale_type or new.sale_settings is distinct from old.sale_settings) then
    raise exception 'Sale type can only change before the lot opens' using errcode = 'P0001';
  end if;
  if new.sale_type <> 'english' then
    select a.mode into m from public.auctions a where a.id = new.auction_id;
    if m = 'league' then
      raise exception 'League auctions use standard bidding' using errcode = 'P0001';
    end if;
  end if;
  if new.sale_type = 'dutch' then
    if coalesce((s ->> 'step')::numeric, 0) <= 0
       or coalesce((s ->> 'floor')::numeric, 0) <= 0
       or (s ->> 'floor')::numeric >= new.start_price
       or coalesce((s ->> 'interval_s')::int, 0) not between 5 and 3600 then
      raise exception 'Dutch lots need a drop amount, a drop interval of 5 to 3600 seconds and a floor price above 0 and below the start price'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger lots_sale_type_guard before insert or update on public.lots
  for each row execute function public.guard_sale_type();
revoke execute on function public.guard_sale_type() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Standard bidding and buy now: thin wrappers around the original engine
-- ---------------------------------------------------------------------------
alter function public.place_bid(uuid, numeric, numeric) rename to _place_bid_english;
revoke execute on function public._place_bid_english(uuid, numeric, numeric) from public, anon, authenticated;

create or replace function public.place_bid(p_lot_id uuid, p_amount numeric, p_max_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  select l.sale_type into t from public.lots l where l.id = p_lot_id;
  if t = 'dutch' then
    raise exception 'This is a Dutch lot. Accept the current price to buy it.' using errcode = 'P0001';
  elsif t = 'sealed' then
    raise exception 'This lot takes sealed bids' using errcode = 'P0001';
  elsif t = 'offer' then
    raise exception 'This lot takes offers' using errcode = 'P0001';
  end if;
  return public._place_bid_english(p_lot_id, p_amount, p_max_amount);
end;
$$;
revoke execute on function public.place_bid(uuid, numeric, numeric) from public, anon;
grant execute on function public.place_bid(uuid, numeric, numeric) to authenticated;

alter function public.buy_now(uuid) rename to _buy_now_core;
revoke execute on function public._buy_now_core(uuid) from public, anon, authenticated;

create or replace function public.buy_now(p_lot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t   text;
  res jsonb;
begin
  select l.sale_type into t from public.lots l where l.id = p_lot_id;
  if t in ('dutch', 'sealed') then
    raise exception 'Buy now is not available for this lot' using errcode = 'P0001';
  end if;
  res := public._buy_now_core(p_lot_id);
  update public.lot_offers set status = 'expired', responded_at = now()
   where lot_id = p_lot_id and status = 'pending';
  return res;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dutch
-- ---------------------------------------------------------------------------
create or replace function public._dutch_price(l public.lots, a public.auctions)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  s     jsonb := l.sale_settings;
  t     timestamptz := case when a.status = 'paused' and a.paused_at is not null then a.paused_at else now() end;
  steps int;
begin
  steps := greatest(0, floor(extract(epoch from (t - coalesce(l.opens_at, t))) / greatest(5, (s ->> 'interval_s')::int)))::int;
  return greatest((s ->> 'floor')::numeric, l.start_price - (s ->> 'step')::numeric * steps);
end;
$$;
revoke execute on function public._dutch_price(public.lots, public.auctions) from public, anon, authenticated;

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
revoke execute on function public.dutch_accept(uuid) from public, anon;
grant execute on function public.dutch_accept(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sealed bids
-- ---------------------------------------------------------------------------
create table public.sealed_bids (
  lot_id      uuid not null references public.lots (id) on delete cascade,
  bidder_id   uuid not null references public.profiles (id) on delete cascade,
  amount      numeric(12, 2) not null check (amount > 0),
  updated_at  timestamptz not null default now(),
  primary key (lot_id, bidder_id)
);
alter table public.sealed_bids enable row level security;
revoke all on public.sealed_bids from anon, authenticated;
grant select on public.sealed_bids to authenticated;
-- Nobody, not even the host, sees other people's sealed bids before the reveal.
create policy "own sealed bids" on public.sealed_bids for select to authenticated
  using (bidder_id = (select auth.uid()) or public.is_platform_admin());

create or replace function public.place_sealed_bid(p_lot_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  l    public.lots;
  a    public.auctions;
  prev numeric;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then
    raise exception 'Lot not found' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = l.auction_id;
  perform public._assert_can_bid(uid, l, a);
  if not public.auction_visible(a.id) then
    raise exception 'This auction is private' using errcode = 'P0001';
  end if;
  if l.sale_type <> 'sealed' then
    raise exception 'This lot does not take sealed bids' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount >= 1e10 then
    raise exception 'Invalid bid amount' using errcode = 'P0001';
  end if;
  p_amount := round(p_amount, 2);
  if p_amount < l.start_price or p_amount <= 0 then
    raise exception 'Minimum bid is %', public.format_money(greatest(l.start_price, 0.01), a.settings) using errcode = 'P0001';
  end if;

  select s.amount into prev from public.sealed_bids s where s.lot_id = p_lot_id and s.bidder_id = uid;
  if prev is not null and p_amount <= prev then
    raise exception 'Sealed bids can only be raised' using errcode = 'P0001';
  end if;
  insert into public.sealed_bids (lot_id, bidder_id, amount) values (p_lot_id, uid, p_amount)
  on conflict (lot_id, bidder_id) do update set amount = excluded.amount, updated_at = now();
  if prev is null then
    update public.lots set bid_count = bid_count + 1 where id = p_lot_id;
  end if;
  return jsonb_build_object('status', 'sealed', 'amount', p_amount);
end;
$$;
revoke execute on function public.place_sealed_bid(uuid, numeric) from public, anon;
grant execute on function public.place_sealed_bid(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Offers
-- ---------------------------------------------------------------------------
create table public.lot_offers (
  id            uuid primary key default gen_random_uuid(),
  lot_id        uuid not null references public.lots (id) on delete cascade,
  bidder_id     uuid not null references public.profiles (id) on delete cascade,
  amount        numeric(12, 2) not null check (amount > 0),
  message       text not null default '' check (char_length(message) <= 200),
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'expired')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);
create unique index lot_offers_one_pending on public.lot_offers (lot_id, bidder_id) where status = 'pending';
create index lot_offers_lot_idx on public.lot_offers (lot_id, created_at desc);
alter table public.lot_offers enable row level security;
revoke all on public.lot_offers from anon, authenticated;
grant select on public.lot_offers to authenticated;
create policy "offers visible to bidder and host" on public.lot_offers for select to authenticated
  using (
    bidder_id = (select auth.uid())
    or public.is_platform_admin()
    or exists (select 1 from public.lots l join public.auctions a on a.id = l.auction_id
                where l.id = lot_id and a.host_id = (select auth.uid()))
  );
alter publication supabase_realtime add table public.lot_offers;

create or replace function public.make_offer(p_lot_id uuid, p_amount numeric, p_message text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  l      public.lots;
  a      public.auctions;
  n      int;
  new_id uuid;
  name   text;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then
    raise exception 'Lot not found' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = l.auction_id;
  perform public._assert_can_bid(uid, l, a);
  if not public.auction_visible(a.id) then
    raise exception 'This auction is private' using errcode = 'P0001';
  end if;
  if l.sale_type <> 'offer' then
    raise exception 'This lot does not take offers' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e10 then
    raise exception 'Invalid offer amount' using errcode = 'P0001';
  end if;
  p_amount := round(p_amount, 2);
  if p_amount < l.start_price then
    raise exception 'Minimum offer is %', public.format_money(l.start_price, a.settings) using errcode = 'P0001';
  end if;
  select count(*) into n from public.lot_offers o where o.lot_id = p_lot_id and o.bidder_id = uid;
  if n >= 10 then
    raise exception 'You have made the maximum number of offers on this lot' using errcode = 'P0001';
  end if;

  update public.lot_offers set status = 'withdrawn', responded_at = now()
   where lot_id = p_lot_id and bidder_id = uid and status = 'pending';
  insert into public.lot_offers (lot_id, bidder_id, amount, message)
  values (p_lot_id, uid, p_amount, left(coalesce(p_message, ''), 200))
  returning id into new_id;
  update public.lots set bid_count = bid_count + 1 where id = p_lot_id;

  select p.display_name into name from public.profiles p where p.id = uid;
  perform public._notify(a.host_id, 'system', format('New offer on "%s"', l.title),
    format('%s offered %s.', name, public.format_money(p_amount, a.settings)), '/a/' || a.id, 'offer:' || new_id);
  return new_id;
end;
$$;
revoke execute on function public.make_offer(uuid, numeric, text) from public, anon;
grant execute on function public.make_offer(uuid, numeric, text) to authenticated;

create or replace function public.withdraw_offer(p_offer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.lot_offers set status = 'withdrawn', responded_at = now()
   where id = p_offer_id and bidder_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Offer not found' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.withdraw_offer(uuid) from public, anon;
grant execute on function public.withdraw_offer(uuid) to authenticated;

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
  select * into l from public.lots where id = o.lot_id for update;
  a := public._assert_host(l.auction_id);
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
revoke execute on function public.respond_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_offer(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Closing: reveal sealed bids, expire open offers, then the usual sold/unsold.
-- ---------------------------------------------------------------------------
create or replace function public._close_lot(p_lot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l             public.lots;
  a             public.auctions;
  winner_label  text;
  top_bidder    uuid;
  top_amount    numeric;
  reserve       numeric;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null or l.status <> 'open' then
    return;
  end if;
  select * into a from public.auctions where id = l.auction_id;

  if l.sale_type = 'sealed' then
    select s.bidder_id, s.amount into top_bidder, top_amount
      from public.sealed_bids s where s.lot_id = l.id
     order by s.amount desc, s.updated_at asc limit 1;
    if top_bidder is not null then
      -- Reveal: every sealed bid enters the public bid log, lowest first.
      insert into public.bids (lot_id, bidder_id, amount, is_auto)
      select s.lot_id, s.bidder_id, s.amount, false from public.sealed_bids s
       where s.lot_id = l.id order by s.amount asc, s.updated_at desc;
      select r.reserve_price into reserve from public.lot_reserves r where r.lot_id = l.id;
      update public.lots
         set current_bid = top_amount, current_winner_id = top_bidder,
             reserve_met = (reserve is null or top_amount >= reserve)
       where id = l.id
      returning * into l;
    end if;
    delete from public.sealed_bids where lot_id = l.id;
  elsif l.sale_type = 'offer' then
    update public.lot_offers set status = 'expired', responded_at = now()
     where lot_id = l.id and status = 'pending';
  end if;

  if l.current_winner_id is not null and l.reserve_met then
    update public.lots set status = 'sold', ends_at = least(ends_at, now()) where id = l.id;
    if a.mode = 'league' and l.winner_team_id is not null then
      update public.league_teams set purse_left = purse_left - l.current_bid where id = l.winner_team_id
        returning name into winner_label;
    else
      select p.display_name into winner_label from public.profiles p where p.id = l.current_winner_id;
    end if;
    perform public._chat_system(a.id, 'system',
      format('SOLD: "%s" to %s at %s', l.title, winner_label, public.format_money(l.current_bid, a.settings)));
  else
    update public.lots set status = 'unsold', winner_team_id = null, ends_at = least(ends_at, now()) where id = l.id;
    perform public._chat_system(a.id, 'system',
      format('"%s" closed unsold%s', l.title,
             case when l.current_winner_id is not null then ' (reserve not met)' else '' end));
  end if;
end;
$$;

-- Duplicates keep each lot's sale type.
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
    insert into public.lots (id, auction_id, position, title, description, start_price, buy_now_price, custom_fields, sale_type, sale_settings)
    select new_lot_id, new_id, position, title, description, start_price, buy_now_price, custom_fields, sale_type, sale_settings from src
    returning id
  )
  insert into public.lot_reserves (lot_id, reserve_price)
  select s.new_lot_id, r.reserve_price from src s join public.lot_reserves r on r.lot_id = s.id;

  return new_id;
end;
$$;
