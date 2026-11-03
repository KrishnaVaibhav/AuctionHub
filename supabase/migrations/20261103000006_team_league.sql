-- Team league mode (IPL-style auction game).
-- Teams join with a virtual purse. Lots ("players") go on the block one at a
-- time; each bid resets a short timer; the sold price comes out of the
-- winning team's purse. Leaderboard = host-assigned points per player.
--
-- settings.league = {
--   purse: 1000000000, squad_min: 0, squad_max: 25, max_teams: 10,
--   lot_seconds: 30,    -- timer when a player comes up
--   bid_seconds: 15,    -- timer resets to at least this after each bid
--   break_seconds: 5,   -- pause between players
--   min_base: 0,        -- purse kept back per unfilled squad_min slot
--   host_can_play: false
-- }

alter table public.auctions
  add column mode text not null default 'standard' check (mode in ('standard', 'league'));
grant insert (mode), update (mode) on public.auctions to authenticated;

create or replace function public.guard_auction_mode()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mode is distinct from old.mode and old.status <> 'draft' then
    raise exception 'Auction mode can only change while it is a draft' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger auctions_guard_mode before update on public.auctions
  for each row execute function public.guard_auction_mode();

create table public.league_teams (
  id          uuid primary key default gen_random_uuid(),
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 40),
  short_name  text not null check (short_name ~ '^[A-Z0-9]{2,4}$'),
  color       text not null default '#f59e0b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  purse_left  numeric(14, 2) not null check (purse_left >= 0),
  created_at  timestamptz not null default now(),
  unique (auction_id, owner_id),
  unique (auction_id, short_name)
);
create index league_teams_auction_idx on public.league_teams (auction_id);

alter table public.league_teams enable row level security;
create policy "teams readable" on public.league_teams for select using (public.auction_visible(auction_id));
revoke all on public.league_teams from anon, authenticated;
grant select on public.league_teams to anon, authenticated;

alter table public.lots add column winner_team_id uuid references public.league_teams (id) on delete set null;
alter table public.lots add column points numeric(10, 2);
alter table public.bids add column team_id uuid references public.league_teams (id) on delete set null;
create index lots_team_idx on public.lots (winner_team_id) where winner_team_id is not null;

alter publication supabase_realtime add table public.league_teams;

-- ---------------------------------------------------------------------------
-- Settings helper
-- ---------------------------------------------------------------------------
create or replace function public.league_setting(p_settings jsonb, p_key text, p_default numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce((p_settings -> 'league' ->> p_key)::numeric, p_default);
$$;

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
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
  if a.status <> 'scheduled' then
    raise exception 'Teams can only join before the league starts' using errcode = 'P0001';
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

  insert into public.league_teams (auction_id, owner_id, name, short_name, color, purse_left)
  values (p_auction_id, uid, btrim(p_name), upper(btrim(p_short_name)), coalesce(p_color, '#f59e0b'),
          public.league_setting(a.settings, 'purse', 1000000000))
  returning id into tid;
  return tid;
exception
  when unique_violation then
    raise exception 'You already have a team here, or that short name is taken' using errcode = 'P0001';
end;
$$;

create or replace function public.leave_league(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.auctions where id = p_auction_id and status in ('draft', 'scheduled')) then
    raise exception 'You can only leave before the league starts' using errcode = 'P0001';
  end if;
  delete from public.league_teams where auction_id = p_auction_id and owner_id = auth.uid();
end;
$$;

create or replace function public.remove_league_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.league_teams;
begin
  select * into t from public.league_teams where id = p_team_id;
  if t.id is null then
    raise exception 'Team not found' using errcode = 'P0001';
  end if;
  perform public._assert_host(t.auction_id);
  if not exists (select 1 from public.auctions where id = t.auction_id and status in ('draft', 'scheduled')) then
    raise exception 'Teams can only be removed before the league starts' using errcode = 'P0001';
  end if;
  delete from public.league_teams where id = p_team_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Put the next pending player on the block (after a short break)
-- ---------------------------------------------------------------------------
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
  select * into a from public.auctions where id = p_auction_id;
  if a.mode <> 'league' or a.status not in ('live', 'paused') then
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

-- ---------------------------------------------------------------------------
-- Lifecycle functions updated for league mode
-- ---------------------------------------------------------------------------
create or replace function public._assert_can_bid(p_uid uuid, l public.lots, a public.auctions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if a.mode = 'league' then
    raise exception 'Use team bidding in league auctions' using errcode = 'P0001';
  end if;
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

create or replace function public._close_lot(p_lot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l     public.lots;
  a     public.auctions;
  winner_label  text;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null or l.status <> 'open' then
    return;
  end if;
  select * into a from public.auctions where id = l.auction_id;

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
  select * into a from public.auctions where id = p_auction_id for update;
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
  if a.mode = 'league' and (select count(*) from public.league_teams where auction_id = p_auction_id) < 2 then
    raise exception 'At least 2 teams must join before the league starts' using errcode = 'P0001';
  end if;
  perform public._start_auction(p_auction_id);
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
  update public.lots
     set ends_at = ends_at + paused,
         opens_at = case when opens_at > a.paused_at then opens_at + paused else opens_at end
   where auction_id = p_auction_id and status = 'open';
  update public.auctions
     set status = 'live', paused_at = null, ends_at = ends_at + paused
   where id = p_auction_id;
  perform public._chat_system(p_auction_id, 'system', 'The auction has resumed.');
end;
$$;

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
  perform public._league_open_next(aid);
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
  update public.lots set status = 'withdrawn', winner_team_id = null,
         ends_at = least(coalesce(ends_at, now()), now())
   where id = p_lot_id;
  perform public._chat_system(l.auction_id, 'system', format('"%s" was withdrawn by the host', l.title));
  perform public._league_open_next(l.auction_id);
  perform public._end_auction_if_done(l.auction_id);
end;
$$;

-- Closes the player on the block once its timer runs out and brings up the next.
-- Safe for anyone to call: it only acts when the timer has really expired.
create or replace function public.league_tick(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
begin
  if not exists (select 1 from public.auctions where id = p_auction_id and mode = 'league' and status = 'live') then
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

  for rec in select id from public.auctions where status = 'live' and mode = 'league' loop
    perform public._league_open_next(rec.id);
  end loop;

  for rec in select id from public.auctions where status = 'live' loop
    perform public._end_auction_if_done(rec.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- league_bid: a team bids on the player on the block
-- ---------------------------------------------------------------------------
create or replace function public.league_bid(p_lot_id uuid, p_amount numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid          uuid := auth.uid();
  l            public.lots;
  a            public.auctions;
  t            public.league_teams;
  squad        int;
  squad_min    int;
  reserve_need numeric;
  min_bid      numeric;
  recent       int;
  new_ends_at  timestamptz;
begin
  if uid is null then
    raise exception 'Sign in to bid' using errcode = 'P0001';
  end if;
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then
    raise exception 'Player not found' using errcode = 'P0001';
  end if;
  select * into a from public.auctions where id = l.auction_id;
  if a.mode <> 'league' then
    raise exception 'This is not a league auction' using errcode = 'P0001';
  end if;
  if a.status <> 'live' then
    raise exception 'The league is not live' using errcode = 'P0001';
  end if;
  if l.status <> 'open' or l.ends_at <= now() then
    raise exception 'Bidding is closed for this player' using errcode = 'P0001';
  end if;
  if l.opens_at > now() then
    raise exception 'Bidding opens in a moment' using errcode = 'P0001';
  end if;

  select * into t from public.league_teams where auction_id = a.id and owner_id = uid for update;
  if t.id is null then
    raise exception 'You need a team in this league to bid' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.id = uid and p.banned_until > now()) then
    raise exception 'Your account is suspended' using errcode = 'P0001';
  end if;
  if l.winner_team_id = t.id then
    raise exception 'Your team already has the highest bid' using errcode = 'P0001';
  end if;

  select count(*) into squad from public.lots where winner_team_id = t.id and status = 'sold';
  if squad >= public.league_setting(a.settings, 'squad_max', 25) then
    raise exception 'Your squad is full' using errcode = 'P0001';
  end if;

  p_amount := round(p_amount, 2);
  min_bid := case
               when l.current_bid is null then l.start_price
               else l.current_bid + public.bid_increment(l.current_bid, a.settings)
             end;
  if p_amount is null or p_amount < min_bid then
    raise exception 'Minimum bid is %', public.format_money(min_bid, a.settings) using errcode = 'P0001';
  end if;

  squad_min := public.league_setting(a.settings, 'squad_min', 0)::int;
  reserve_need := greatest(squad_min - squad - 1, 0) * public.league_setting(a.settings, 'min_base', 0);
  if p_amount > t.purse_left - reserve_need then
    raise exception 'Not enough purse: % left%', public.format_money(t.purse_left, a.settings),
      case when reserve_need > 0 then format(' (must keep %s for remaining squad)', public.format_money(reserve_need, a.settings)) else '' end
      using errcode = 'P0001';
  end if;

  select count(*) into recent from public.bids b
   where b.lot_id = p_lot_id and b.bidder_id = uid and b.created_at > now() - interval '5 seconds';
  if recent >= 5 then
    raise exception 'Too many bids. Wait a moment.' using errcode = 'P0001';
  end if;

  insert into public.bids (lot_id, bidder_id, amount, is_auto, team_id) values (p_lot_id, uid, p_amount, false, t.id);

  new_ends_at := greatest(l.ends_at, now() + make_interval(secs => public.league_setting(a.settings, 'bid_seconds', 15)::int));
  update public.lots
     set current_bid = p_amount, current_winner_id = uid, winner_team_id = t.id,
         bid_count = bid_count + 1, reserve_met = true, ends_at = new_ends_at
   where id = p_lot_id;

  perform public._chat_system(a.id, 'bid', format('%s bids %s for %s', t.short_name, public.format_money(p_amount, a.settings), l.title));

  return jsonb_build_object('status', 'leading', 'current_bid', p_amount, 'team_id', t.id, 'ends_at', new_ends_at,
    'min_next_bid', p_amount + public.bid_increment(p_amount, a.settings));
end;
$$;

-- Bring every unsold player back for another round.
create or replace function public.league_requeue_unsold(p_auction_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  a     public.auctions := public._assert_host(p_auction_id);
  maxp  int;
  n     int;
begin
  if a.mode <> 'league' or a.status not in ('live', 'paused', 'ended') then
    raise exception 'Only for running or finished league auctions' using errcode = 'P0001';
  end if;
  select coalesce(max(position), 0) into maxp from public.lots where auction_id = p_auction_id;
  with u as (
    select id, row_number() over (order by position, created_at) as rn
      from public.lots where auction_id = p_auction_id and status = 'unsold'
  )
  update public.lots l
     set status = 'pending', position = maxp + u.rn, current_bid = null, current_winner_id = null,
         winner_team_id = null, opens_at = null, ends_at = null
    from u
   where l.id = u.id;
  get diagnostics n = row_count;
  if n > 0 then
    update public.auctions set status = 'live' where id = p_auction_id and status = 'ended';
    perform public._chat_system(p_auction_id, 'system', format('%s unsold players are back for another round', n));
    perform public._league_open_next(p_auction_id);
  end if;
  return n;
end;
$$;

create or replace function public.set_lot_points(p_lot_id uuid, p_points numeric)
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
  update public.lots set points = p_points where id = p_lot_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public._league_open_next(uuid),
  public.guard_auction_mode()
from public, anon, authenticated;

revoke execute on function
  public.join_league(uuid, text, text, text),
  public.leave_league(uuid),
  public.remove_league_team(uuid),
  public.league_bid(uuid, numeric),
  public.league_requeue_unsold(uuid),
  public.set_lot_points(uuid, numeric)
from public, anon;

grant execute on function
  public.join_league(uuid, text, text, text),
  public.leave_league(uuid),
  public.remove_league_team(uuid),
  public.league_bid(uuid, numeric),
  public.league_requeue_unsold(uuid),
  public.set_lot_points(uuid, numeric)
to authenticated;

grant execute on function public.league_tick(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Short money format for chat lines when settings.compact (e.g. ₹2.25Cr, ₹50L)
-- ---------------------------------------------------------------------------
create or replace function public.format_money(p_amount numeric, p_settings jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_settings ->> 'currency', 'INR') = 'PTS' then
      to_char(p_amount, 'FM999,999,999,990') || ' pts'
    when coalesce((p_settings ->> 'compact')::boolean, false) and coalesce(p_settings ->> 'currency', 'INR') = 'INR' then
      case
        when p_amount >= 10000000 then '₹' || trim_scale(round(p_amount / 10000000, 2))::text || 'Cr'
        when p_amount >= 100000 then '₹' || trim_scale(round(p_amount / 100000, 2))::text || 'L'
        else '₹' || to_char(p_amount, 'FM999,999,990')
      end
    else coalesce(p_settings ->> 'currency', 'INR') || ' ' || to_char(p_amount, 'FM999,999,999,990.00')
  end;
$$;
