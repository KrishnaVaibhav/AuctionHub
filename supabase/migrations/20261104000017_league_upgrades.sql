-- League upgrades: retention, right to match (RTM), player category limits,
-- trades and next season.
--
-- settings.league adds:
--   retain_max: 4       players a team may keep before the auction
--   rtm_cards: 0        right-to-match cards per team (0 turns RTM off)
--   rtm_seconds: 20     time the previous team has to decide
--   category_max: {}    e.g. {"Overseas": 8}; a player's category is lots.custom_fields.Category
--   trades: true        trades allowed while paused or after the auction ends

alter table public.lots
  add column rtm_team_id uuid references public.league_teams (id) on delete set null,
  add column rtm_offered boolean not null default false,
  add column retained boolean not null default false;
grant insert (rtm_team_id), update (rtm_team_id) on public.lots to authenticated;

alter table public.league_teams add column rtm_used int not null default 0;

create or replace function public.guard_rtm_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rtm_team_id is not null and (tg_op = 'INSERT' or new.rtm_team_id is distinct from old.rtm_team_id) then
    if tg_op = 'UPDATE' and old.status <> 'pending' then
      raise exception 'Right to match can only be set before the player is auctioned' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.league_teams t where t.id = new.rtm_team_id and t.auction_id = new.auction_id) then
      raise exception 'That team is not in this league' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger lots_rtm_guard before insert or update of rtm_team_id on public.lots
  for each row execute function public.guard_rtm_team();
revoke execute on function public.guard_rtm_team() from public, anon, authenticated;

create or replace function public._league_category(l public.lots)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(l.custom_fields ->> 'Category', l.custom_fields ->> 'category')), '');
$$;
revoke execute on function public._league_category(public.lots) from public, anon, authenticated;

-- Team bids: blocked while a right-to-match decision is pending, and capped per category.
create or replace function public.guard_league_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l    public.lots;
  a    public.auctions;
  cat  text;
  cap  numeric;
  have int;
begin
  if new.team_id is null then
    return new;
  end if;
  select * into l from public.lots where id = new.lot_id;
  if l.rtm_offered and new.team_id is distinct from l.rtm_team_id then
    raise exception 'Waiting for the right-to-match decision' using errcode = 'P0001';
  end if;
  cat := public._league_category(l);
  if cat is not null then
    select * into a from public.auctions where id = l.auction_id;
    cap := (a.settings -> 'league' -> 'category_max' ->> cat)::numeric;
    if cap is not null then
      select count(*) into have from public.lots x
       where x.winner_team_id = new.team_id and x.status = 'sold' and public._league_category(x) = cat;
      if have >= cap then
        raise exception 'Your team already has % % players', cap, cat using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger bids_league_guard before insert on public.bids
  for each row execute function public.guard_league_bid();
revoke execute on function public.guard_league_bid() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention (host, before the league starts)
-- ---------------------------------------------------------------------------
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
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then
    raise exception 'Player not found' using errcode = 'P0001';
  end if;
  a := public._assert_host(l.auction_id);
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
revoke execute on function public.league_retain(uuid, uuid, numeric) from public, anon;
grant execute on function public.league_retain(uuid, uuid, numeric) to authenticated;

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
  select * into l from public.lots where id = p_lot_id for update;
  a := public._assert_host(l.auction_id);
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
revoke execute on function public.league_unretain(uuid) from public, anon;
grant execute on function public.league_unretain(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Right to match
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
  rt            public.league_teams;
  winner_label  text;
  top_bidder    uuid;
  top_amount    numeric;
  reserve       numeric;
  squad         int;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null or l.status <> 'open' then
    return;
  end if;
  select * into a from public.auctions where id = l.auction_id;

  -- League: offer the previous team a right to match before the player is sold.
  if a.mode = 'league' and l.rtm_team_id is not null and not l.rtm_offered
     and l.winner_team_id is not null and l.winner_team_id <> l.rtm_team_id then
    select * into rt from public.league_teams where id = l.rtm_team_id;
    select count(*) into squad from public.lots x where x.winner_team_id = rt.id and x.status = 'sold';
    if rt.rtm_used < public.league_setting(a.settings, 'rtm_cards', 0)
       and rt.purse_left >= l.current_bid
       and squad < public.league_setting(a.settings, 'squad_max', 25) then
      update public.lots
         set rtm_offered = true,
             ends_at = now() + make_interval(secs => public.league_setting(a.settings, 'rtm_seconds', 20)::int)
       where id = l.id;
      perform public._chat_system(a.id, 'system',
        format('%s can use a right to match on "%s" at %s', rt.name, l.title, public.format_money(l.current_bid, a.settings)));
      perform public._notify(rt.owner_id, 'system', format('Right to match: "%s"', l.title),
        format('Match %s to keep this player. Decide quickly.', public.format_money(l.current_bid, a.settings)),
        '/a/' || a.id, 'rtm:' || l.id);
      return;
    end if;
  end if;

  if l.sale_type = 'sealed' then
    select s.bidder_id, s.amount into top_bidder, top_amount
      from public.sealed_bids s where s.lot_id = l.id
     order by s.amount desc, s.updated_at asc limit 1;
    if top_bidder is not null then
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
    update public.lots set status = 'sold', rtm_offered = false, ends_at = least(ends_at, now()) where id = l.id;
    if a.mode = 'league' and l.winner_team_id is not null then
      update public.league_teams set purse_left = purse_left - l.current_bid where id = l.winner_team_id
        returning name into winner_label;
    else
      select p.display_name into winner_label from public.profiles p where p.id = l.current_winner_id;
    end if;
    perform public._chat_system(a.id, 'system',
      format('SOLD: "%s" to %s at %s', l.title, winner_label, public.format_money(l.current_bid, a.settings)));
  else
    update public.lots set status = 'unsold', winner_team_id = null, rtm_offered = false, ends_at = least(ends_at, now()) where id = l.id;
    perform public._chat_system(a.id, 'system',
      format('"%s" closed unsold%s', l.title,
             case when l.current_winner_id is not null then ' (reserve not met)' else '' end));
  end if;
end;
$$;

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
revoke execute on function public.league_rtm(uuid, boolean) from public, anon;
grant execute on function public.league_rtm(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Trades between teams (while paused or after the auction ends)
-- ---------------------------------------------------------------------------
create table public.league_trades (
  id            uuid primary key default gen_random_uuid(),
  auction_id    uuid not null references public.auctions (id) on delete cascade,
  from_team     uuid not null references public.league_teams (id) on delete cascade,
  to_team       uuid not null references public.league_teams (id) on delete cascade,
  give_lots     uuid[] not null default '{}',
  get_lots      uuid[] not null default '{}',
  cash          numeric(14, 2) not null default 0,  -- positive: from_team pays to_team
  note          text not null default '' check (char_length(note) <= 200),
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (from_team <> to_team),
  check (cardinality(give_lots) <= 10 and cardinality(get_lots) <= 10)
);
create index league_trades_auction_idx on public.league_trades (auction_id, created_at desc);
alter table public.league_trades enable row level security;
revoke all on public.league_trades from anon, authenticated;
grant select on public.league_trades to anon, authenticated;
create policy "trades readable" on public.league_trades for select using (public.auction_visible(auction_id));
alter publication supabase_realtime add table public.league_trades;

create or replace function public._trade_check(tr public.league_trades, a public.auctions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ft      public.league_teams;
  tt      public.league_teams;
  max_sq  numeric := public.league_setting(a.settings, 'squad_max', 25);
  n_from  int;
  n_to    int;
begin
  if a.mode <> 'league' then
    raise exception 'This is not a league auction' using errcode = 'P0001';
  end if;
  if a.status not in ('paused', 'ended') or coalesce((a.settings -> 'league' ->> 'trades')::boolean, true) = false then
    raise exception 'Trades are open while the league is paused or after it ends' using errcode = 'P0001';
  end if;
  select * into ft from public.league_teams where id = tr.from_team and auction_id = a.id;
  select * into tt from public.league_teams where id = tr.to_team and auction_id = a.id;
  if ft.id is null or tt.id is null then
    raise exception 'Team not found' using errcode = 'P0001';
  end if;
  if cardinality(tr.give_lots) = 0 and cardinality(tr.get_lots) = 0 then
    raise exception 'Pick at least one player' using errcode = 'P0001';
  end if;
  if (select count(*) from public.lots where id = any (tr.give_lots) and winner_team_id = ft.id and status = 'sold') <> cardinality(tr.give_lots)
     or (select count(*) from public.lots where id = any (tr.get_lots) and winner_team_id = tt.id and status = 'sold') <> cardinality(tr.get_lots) then
    raise exception 'Those players are no longer on those teams' using errcode = 'P0001';
  end if;
  if ft.purse_left - tr.cash < 0 or tt.purse_left + tr.cash < 0 then
    raise exception 'Not enough purse for that cash amount' using errcode = 'P0001';
  end if;
  select count(*) into n_from from public.lots where winner_team_id = ft.id and status = 'sold';
  select count(*) into n_to from public.lots where winner_team_id = tt.id and status = 'sold';
  if n_from - cardinality(tr.give_lots) + cardinality(tr.get_lots) > max_sq
     or n_to - cardinality(tr.get_lots) + cardinality(tr.give_lots) > max_sq then
    raise exception 'A squad would be over the limit' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public._trade_check(public.league_trades, public.auctions) from public, anon, authenticated;

create or replace function public.league_propose_trade(p_auction_id uuid, p_to_team uuid, p_give uuid[], p_get uuid[], p_cash numeric default 0, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  a   public.auctions;
  tr  public.league_trades;
  to_owner uuid;
begin
  select * into a from public.auctions where id = p_auction_id;
  select t.id into tr.from_team from public.league_teams t where t.auction_id = p_auction_id and t.owner_id = uid;
  if tr.from_team is null then
    raise exception 'You need a team in this league to trade' using errcode = 'P0001';
  end if;
  tr.id := gen_random_uuid();
  tr.auction_id := p_auction_id;
  tr.to_team := p_to_team;
  tr.give_lots := coalesce(p_give, '{}');
  tr.get_lots := coalesce(p_get, '{}');
  tr.cash := round(coalesce(p_cash, 0), 2);
  tr.note := left(coalesce(p_note, ''), 200);
  tr.status := 'pending';
  tr.created_at := now();
  if tr.from_team = tr.to_team then
    raise exception 'Pick another team' using errcode = 'P0001';
  end if;
  perform public._trade_check(tr, a);
  insert into public.league_trades select tr.*;

  select owner_id into to_owner from public.league_teams where id = p_to_team;
  perform public._notify(to_owner, 'system', 'New trade offer', coalesce(nullif(tr.note, ''), 'Open the league to review it.'),
    '/a/' || a.id, 'trade:' || tr.id);
  return tr.id;
end;
$$;
revoke execute on function public.league_propose_trade(uuid, uuid, uuid[], uuid[], numeric, text) from public, anon;
grant execute on function public.league_propose_trade(uuid, uuid, uuid[], uuid[], numeric, text) to authenticated;

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
  select * into ft from public.league_teams where id = tr.from_team for update;
  select * into tt from public.league_teams where id = tr.to_team for update;

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
revoke execute on function public.league_respond_trade(uuid, boolean) from public, anon;
grant execute on function public.league_respond_trade(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Next season: same teams (fresh purses), same players, previous owners get RTM.
-- ---------------------------------------------------------------------------
create or replace function public.league_next_season(p_auction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       public.auctions := public._assert_host(p_auction_id);
  new_id  uuid := gen_random_uuid();
  season  int;
  base    text;
begin
  if a.mode <> 'league' or a.status <> 'ended' then
    raise exception 'Start the next season after this league ends' using errcode = 'P0001';
  end if;
  season := coalesce((a.settings -> 'league' ->> 'season')::int, 1) + 1;
  base := regexp_replace(a.title, '\s*·\s*Season \d+$', '');

  insert into public.auctions (id, host_id, title, description, settings, cover_url, mode, visibility, category, tags)
  values (new_id, a.host_id, left(base || ' · Season ' || season, 120), a.description,
          jsonb_set(a.settings, '{league,season}', to_jsonb(season), true),
          a.cover_url, 'league', a.visibility, a.category, a.tags);

  insert into public.auction_members (auction_id, user_id)
  select new_id, m.user_id from public.auction_members m where m.auction_id = p_auction_id
  on conflict do nothing;

  -- New team ids are derived from (old team, new league) so players can be mapped without a temp table.
  insert into public.league_teams (id, auction_id, owner_id, name, short_name, color, purse_left)
  select md5(t.id::text || new_id::text)::uuid, new_id, t.owner_id, t.name, t.short_name, t.color,
         public.league_setting(a.settings, 'purse', 1000000000)
    from public.league_teams t where t.auction_id = p_auction_id;

  insert into public.lots (auction_id, position, title, description, start_price, custom_fields, rtm_team_id)
  select new_id, l.position, l.title, l.description, l.start_price, l.custom_fields,
         case when l.status = 'sold' and l.winner_team_id is not null then md5(l.winner_team_id::text || new_id::text)::uuid end
    from public.lots l
   where l.auction_id = p_auction_id and l.status <> 'withdrawn';

  return new_id;
end;
$$;
revoke execute on function public.league_next_season(uuid) from public, anon;
grant execute on function public.league_next_season(uuid) to authenticated;
