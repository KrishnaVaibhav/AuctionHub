-- Engagement: host room controls, price guesses and pick'em, badges, XP levels,
-- trophy shelf, referrals, watch parties, reminders, daily mystery lot, themed
-- events, league fixtures (head-to-head weeks) and a trade deadline.
-- XP is earned by watching, chatting, guessing and rating, never by spending.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('outbid', 'won', 'sold', 'unsold', 'closing', 'live', 'deal', 'system', 'reminder', 'badge'));

-- ===========================================================================
-- Host room controls
-- ===========================================================================
alter table public.auctions
  add column announcement     text check (announcement is null or char_length(announcement) <= 200),
  add column spotlight_lot_id uuid references public.lots (id) on delete set null;

create or replace function public.host_set_announcement(p_auction_id uuid, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_host(p_auction_id);
  update public.auctions set announcement = nullif(btrim(left(coalesce(p_text, ''), 200)), '') where id = p_auction_id;
end;
$$;

create or replace function public.host_spotlight(p_auction_id uuid, p_lot_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_host(p_auction_id);
  if p_lot_id is not null and not exists (select 1 from public.lots where id = p_lot_id and auction_id = p_auction_id) then
    raise exception 'Lot not in this auction' using errcode = 'P0001';
  end if;
  update public.auctions set spotlight_lot_id = p_lot_id where id = p_auction_id;
end;
$$;

-- Room features the host can switch on and off at any time (settings.fun).
create or replace function public.host_set_features(p_auction_id uuid, p_features jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a    public.auctions := public._assert_host(p_auction_id);
  keys text[] := array['reactions', 'hype', 'celebrate', 'sounds', 'guesses', 'pickem', 'bingo', 'parties'];
  fun  jsonb := coalesce(a.settings -> 'fun', '{}');
  k    text;
begin
  for k in select jsonb_object_keys(coalesce(p_features, '{}')) loop
    if k = any (keys) and jsonb_typeof(p_features -> k) = 'boolean' then
      fun := fun || jsonb_build_object(k, p_features -> k);
    end if;
  end loop;
  update public.auctions set settings = jsonb_set(settings, '{fun}', fun, true) where id = p_auction_id;
  return fun;
end;
$$;

create or replace function public._fun_on(p_settings jsonb, p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce((p_settings -> 'fun' ->> p_key)::boolean, true);
$$;

-- Move a lot's closing time (extend, or shorten to at least 5 seconds from now).
create or replace function public.set_lot_end(p_lot_id uuid, p_ends_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.lots;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then raise exception 'Lot not found' using errcode = 'P0001'; end if;
  perform public._assert_host(l.auction_id);
  if l.status <> 'open' then raise exception 'Only open lots can be retimed' using errcode = 'P0001'; end if;
  if p_ends_at < now() + interval '5 seconds' or p_ends_at > now() + interval '30 days' then
    raise exception 'Pick a time between 5 seconds and 30 days from now' using errcode = 'P0001';
  end if;
  update public.lots set ends_at = p_ends_at where id = p_lot_id;
end;
$$;

-- Put an unsold or withdrawn lot back up for a few more minutes.
create or replace function public.reopen_lot(p_lot_id uuid, p_minutes int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.lots;
  a public.auctions;
begin
  select * into l from public.lots where id = p_lot_id for update;
  if l.id is null then raise exception 'Lot not found' using errcode = 'P0001'; end if;
  a := public._assert_host(l.auction_id);
  if a.mode = 'league' then raise exception 'Use the league controls to requeue players' using errcode = 'P0001'; end if;
  if a.status not in ('live', 'paused') then raise exception 'Reopen lots while the auction is running' using errcode = 'P0001'; end if;
  if l.status not in ('unsold', 'withdrawn') then raise exception 'Only unsold or withdrawn lots can be reopened' using errcode = 'P0001'; end if;
  if p_minutes not between 1 and 1440 then raise exception 'Reopen for 1 to 1440 minutes' using errcode = 'P0001'; end if;
  update public.lots set status = 'open', opens_at = now(), ends_at = now() + make_interval(mins => p_minutes) where id = p_lot_id;
end;
$$;

revoke execute on function public.host_set_announcement(uuid, text), public.host_spotlight(uuid, uuid), public.host_set_features(uuid, jsonb),
  public.set_lot_end(uuid, timestamptz), public.reopen_lot(uuid, int) from public, anon;
grant execute on function public.host_set_announcement(uuid, text), public.host_spotlight(uuid, uuid), public.host_set_features(uuid, jsonb),
  public.set_lot_end(uuid, timestamptz), public.reopen_lot(uuid, int) to authenticated;

-- ===========================================================================
-- Profiles: XP, cosmetics, trophy shelf opt-in, referral
-- ===========================================================================
alter table public.profiles
  add column xp          int not null default 0 check (xp >= 0),
  add column chat_color  text check (chat_color is null or chat_color in ('amber', 'emerald', 'sky', 'violet', 'rose')),
  add column frame       text check (frame is null or frame in ('silver', 'gold', 'aurora')),
  add column show_shelf  boolean not null default false,
  add column referred_by uuid references public.profiles (id) on delete set null;
grant update (show_shelf) on public.profiles to authenticated;

create or replace function public.xp_level(p_xp int)
returns int language sql immutable set search_path = '' as $$
  select floor(sqrt(greatest(p_xp, 0) / 50.0))::int + 1;
$$;
grant execute on function public.xp_level(int) to anon, authenticated;

create table public.xp_daily (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null default current_date,
  source   text not null,
  amount   int not null default 0,
  primary key (user_id, day, source)
);
alter table public.xp_daily enable row level security;
revoke all on public.xp_daily from anon, authenticated;

-- Grant XP with a per-source daily cap. Returns what was actually granted.
create or replace function public._grant_xp(p_user uuid, p_source text, p_amount int, p_cap int)
returns int language plpgsql security definer set search_path = '' as $$
declare
  got int;
  add int;
begin
  if p_user is null or p_amount <= 0 then return 0; end if;
  insert into public.xp_daily (user_id, source) values (p_user, p_source) on conflict do nothing;
  select amount into got from public.xp_daily where user_id = p_user and day = current_date and source = p_source for update;
  add := least(p_amount, greatest(p_cap - got, 0));
  if add > 0 then
    update public.xp_daily set amount = amount + add where user_id = p_user and day = current_date and source = p_source;
    update public.profiles set xp = xp + add where id = p_user;
  end if;
  return add;
end;
$$;
revoke execute on function public._grant_xp(uuid, text, int, int) from public, anon, authenticated;

create or replace function public.xp_watch(p_auction_id uuid)
returns int language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return 0; end if;
  if not exists (select 1 from public.auctions a where a.id = p_auction_id and a.status = 'live') or not public.auction_visible(p_auction_id) then
    return 0;
  end if;
  return public._grant_xp(auth.uid(), 'watch', 2, 60);
end;
$$;

create or replace function public.set_cosmetics(p_color text, p_frame text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  lvl int;
begin
  select public.xp_level(xp) into lvl from public.profiles where id = auth.uid();
  if lvl is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  if p_color is not null and lvl < 3 then raise exception 'Chat colours unlock at level 3' using errcode = 'P0001'; end if;
  if (p_frame = 'silver' and lvl < 5) or (p_frame = 'gold' and lvl < 10) or (p_frame = 'aurora' and lvl < 15) then
    raise exception 'That frame is still locked' using errcode = 'P0001';
  end if;
  update public.profiles set chat_color = p_color, frame = p_frame where id = auth.uid();
end;
$$;

revoke execute on function public.xp_watch(uuid), public.set_cosmetics(text, text) from public, anon;
grant execute on function public.xp_watch(uuid), public.set_cosmetics(text, text) to authenticated;

create or replace function public.xp_on_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'chat_messages' then
    if new.kind = 'text' then perform public._grant_xp(new.user_id, 'chat', 2, 40); end if;
  elsif tg_table_name = 'ratings' then
    perform public._grant_xp(new.rater_id, 'rating', 10, 50);
  end if;
  return null;
end;
$$;
revoke execute on function public.xp_on_activity() from public, anon, authenticated;
create trigger chat_xp after insert on public.chat_messages for each row execute function public.xp_on_activity();
create trigger ratings_xp after insert on public.ratings for each row execute function public.xp_on_activity();

-- ===========================================================================
-- Badges
-- ===========================================================================
create table public.user_badges (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  badge       text not null check (badge ~ '^[a-z_]+(:[0-9a-f-]{36})?$'),
  ref         text,
  awarded_at  timestamptz not null default now(),
  primary key (user_id, badge)
);
alter table public.user_badges enable row level security;
revoke all on public.user_badges from anon, authenticated;
grant select on public.user_badges to anon, authenticated;
create policy "badges readable" on public.user_badges for select using (true);

create or replace function public._award(p_user uuid, p_badge text, p_ref text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  if p_user is null then return false; end if;
  insert into public.user_badges (user_id, badge, ref) values (p_user, p_badge, p_ref) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    perform public._notify(p_user, 'badge', 'New badge unlocked',
      'You earned the "' || replace(split_part(p_badge, ':', 1), '_', ' ') || '" badge.', '/account', 'badge:' || p_badge);
  end if;
  return n > 0;
end;
$$;
revoke execute on function public._award(uuid, text, text) from public, anon, authenticated;

-- Night owl: a bid between midnight and 4 a.m. India time.
create or replace function public.badge_on_bid()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if extract(hour from new.created_at at time zone 'Asia/Kolkata') < 4
     and not exists (select 1 from public.user_badges where user_id = new.bidder_id and badge = 'night_owl') then
    perform public._award(new.bidder_id, 'night_owl');
  end if;
  return null;
end;
$$;
revoke execute on function public.badge_on_bid() from public, anon, authenticated;
create trigger bids_badges after insert on public.bids for each row execute function public.badge_on_bid();

-- ===========================================================================
-- Predictions: guess the price, and league pick'em
-- ===========================================================================
create table public.predictions (
  lot_id     uuid not null references public.lots (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('price', 'team')),
  amount     numeric(12, 2) check (amount is null or amount > 0),
  team_id    uuid references public.league_teams (id) on delete cascade,
  points     int,
  created_at timestamptz not null default now(),
  scored_at  timestamptz,
  primary key (lot_id, user_id, kind),
  check ((kind = 'price' and amount is not null) or (kind = 'team' and team_id is not null))
);
create index predictions_scored_idx on public.predictions (scored_at) where scored_at is not null;
alter table public.predictions enable row level security;
revoke all on public.predictions from anon, authenticated;
grant select on public.predictions to anon, authenticated;
-- Your own guesses always; everyone's once the lot has closed.
create policy "predictions readable" on public.predictions for select using (
  user_id = (select auth.uid())
  or exists (select 1 from public.lots l where l.id = lot_id and l.status in ('sold', 'unsold', 'withdrawn') and public.auction_visible(l.auction_id))
);

create or replace function public.make_prediction(p_lot_id uuid, p_kind text, p_amount numeric, p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l  public.lots;
  a  public.auctions;
  n  int;
begin
  if auth.uid() is null then raise exception 'Sign in to play' using errcode = 'P0001'; end if;
  select * into l from public.lots where id = p_lot_id;
  if l.id is null or not public.auction_visible(l.auction_id) then raise exception 'Lot not found' using errcode = 'P0001'; end if;
  select * into a from public.auctions where id = l.auction_id;
  if a.host_id = auth.uid() or public.is_auction_cohost(a.id) then
    raise exception 'Hosts can''t play in their own auction' using errcode = 'P0001';
  end if;
  if not public._fun_on(a.settings, case when p_kind = 'team' then 'pickem' else 'guesses' end) then
    raise exception 'The host has turned this game off' using errcode = 'P0001';
  end if;
  if l.status not in ('pending', 'open') or l.bid_count > 0 or l.current_bid is not null then
    raise exception 'Guesses lock once bidding starts' using errcode = 'P0001';
  end if;
  if p_kind = 'team' then
    if a.mode <> 'league' or not exists (select 1 from public.league_teams t where t.id = p_team_id and t.auction_id = a.id) then
      raise exception 'Pick a team in this league' using errcode = 'P0001';
    end if;
  elsif p_kind = 'price' then
    if p_amount is null or p_amount <= 0 or p_amount > 1e10 then raise exception 'Enter a price' using errcode = 'P0001'; end if;
  else
    raise exception 'Unknown game' using errcode = 'P0001';
  end if;

  insert into public.predictions (lot_id, user_id, kind, amount, team_id)
  values (p_lot_id, auth.uid(), p_kind, case when p_kind = 'price' then round(p_amount, 2) end, case when p_kind = 'team' then p_team_id end)
  on conflict (lot_id, user_id, kind) do update set amount = excluded.amount, team_id = excluded.team_id, created_at = now();
  get diagnostics n = row_count;
  perform public._grant_xp(auth.uid(), 'guess', 5, 50);
end;
$$;
revoke execute on function public.make_prediction(uuid, text, numeric, uuid) from public, anon;
grant execute on function public.make_prediction(uuid, text, numeric, uuid) to authenticated;

-- How many people have guessed, without revealing the guesses.
create or replace function public.prediction_counts(p_auction_id uuid)
returns table (lot_id uuid, guesses int, picks int)
language sql stable security definer set search_path = '' as $$
  select p.lot_id, count(*) filter (where p.kind = 'price')::int, count(*) filter (where p.kind = 'team')::int
    from public.predictions p join public.lots l on l.id = p.lot_id
   where l.auction_id = p_auction_id and public.auction_visible(p_auction_id)
   group by p.lot_id;
$$;
grant execute on function public.prediction_counts(uuid) to anon, authenticated;

create or replace function public.prediction_leaderboard(p_days int default 7, p_auction_id uuid default null)
returns table (user_id uuid, display_name text, points bigint, guesses bigint, rank bigint)
language sql stable security definer set search_path = '' as $$
  select p.user_id, pr.display_name, sum(p.points), count(*), rank() over (order by sum(p.points) desc)
    from public.predictions p
    join public.lots l on l.id = p.lot_id
    join public.profiles pr on pr.id = p.user_id
   where p.scored_at is not null
     and (p_auction_id is null or l.auction_id = p_auction_id)
     and (p_auction_id is not null or p.scored_at > now() - make_interval(days => least(greatest(p_days, 1), 365)))
     and public.auction_visible(l.auction_id)
   group by p.user_id, pr.display_name
   order by sum(p.points) desc
   limit 25;
$$;
grant execute on function public.prediction_leaderboard(int, uuid) to anon, authenticated;

-- ===========================================================================
-- Themed events and the daily mystery lot (platform admins manage both)
-- ===========================================================================
create table public.site_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 3 and 60),
  tag         text not null check (tag ~ '^[a-z0-9-]{2,30}$'),
  description text not null default '' check (char_length(description) <= 300),
  color       text not null default '#f59e0b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.site_events enable row level security;
revoke all on public.site_events from anon, authenticated;
grant select on public.site_events to anon, authenticated;
grant insert, update, delete on public.site_events to authenticated;
create policy "events readable" on public.site_events for select using (true);
create policy "events admin write" on public.site_events for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create table public.mystery_drops (
  day        date primary key,
  lot_id     uuid not null references public.lots (id) on delete cascade,
  reveal_at  timestamptz not null,
  teaser     text not null default '' check (char_length(teaser) <= 120)
);
alter table public.mystery_drops enable row level security;
revoke all on public.mystery_drops from anon, authenticated;
grant select, insert, update, delete on public.mystery_drops to authenticated;
create policy "mystery admin" on public.mystery_drops for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.mystery_today()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  d record;
begin
  select m.*, a.category, a.id as auction_id, a.settings, l.title, l.start_price, l.current_bid, l.status as lot_status,
         (select path from public.lot_media lm where lm.lot_id = l.id and lm.kind = 'image' order by position limit 1) as cover
    into d
    from public.mystery_drops m
    join public.lots l on l.id = m.lot_id
    join public.auctions a on a.id = l.auction_id
   where m.day = (now() at time zone 'Asia/Kolkata')::date
     and a.visibility = 'public' and a.status not in ('draft', 'cancelled');
  if not found then return null; end if;
  if now() < d.reveal_at then
    return jsonb_build_object('revealed', false, 'reveal_at', d.reveal_at, 'teaser', d.teaser, 'category', d.category);
  end if;
  return jsonb_build_object('revealed', true, 'reveal_at', d.reveal_at, 'teaser', d.teaser, 'category', d.category,
    'lot_id', d.lot_id, 'auction_id', d.auction_id, 'title', d.title, 'cover', d.cover, 'status', d.lot_status,
    'price', coalesce(d.current_bid, d.start_price), 'currency', coalesce(d.settings ->> 'currency', 'INR'));
end;
$$;
grant execute on function public.mystery_today() to anon, authenticated;

-- ===========================================================================
-- Lot closes: score predictions and award badges
-- ===========================================================================
create or replace function public.engagement_on_close()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a        public.auctions;
  winner   uuid;
  last_bid timestamptz;
  wins     int;
  ref_by   uuid;
  ev       record;
  p        record;
  pts      int;
  err      numeric;
begin
  if new.status is not distinct from old.status or new.status not in ('sold', 'unsold', 'withdrawn') then
    return null;
  end if;
  select * into a from public.auctions where id = new.auction_id;

  -- Predictions
  for p in select * from public.predictions where lot_id = new.id and scored_at is null for update loop
    pts := 0;
    if new.status = 'sold' and p.kind = 'price' and new.current_bid > 0 then
      err := abs(p.amount - new.current_bid) / new.current_bid;
      pts := case when err <= 0.02 then 100 when err <= 0.05 then 75 when err <= 0.10 then 50 when err <= 0.25 then 25 else 5 end;
      if err <= 0.02 then perform public._award(p.user_id, 'bullseye'); end if;
    elsif new.status = 'sold' and p.kind = 'team' and p.team_id = new.winner_team_id then
      pts := 50;
    end if;
    update public.predictions set points = pts, scored_at = now() where lot_id = p.lot_id and user_id = p.user_id and kind = p.kind;
    perform public._grant_xp(p.user_id, 'guess_score', pts / 5, 1000);
  end loop;

  if new.status <> 'sold' then return null; end if;

  winner := coalesce(new.current_winner_id, (select t.owner_id from public.league_teams t where t.id = new.winner_team_id));
  if winner is null then return null; end if;

  select count(*) into wins from public.lots l where l.current_winner_id = winner and l.status = 'sold';
  perform public._award(winner, 'first_win', new.id::text);
  if wins >= 10 then perform public._award(winner, 'collector'); end if;
  if new.current_bid is not null and new.current_bid <= new.start_price and a.mode = 'standard' then
    perform public._award(winner, 'bargain', new.id::text);
  end if;
  select max(created_at) into last_bid from public.bids where lot_id = new.id and bidder_id = winner;
  if last_bid is not null and new.ends_at is not null and new.ends_at - last_bid <= make_interval(secs => coalesce((a.settings ->> 'anti_snipe_seconds')::int, 30) + 5) and new.bid_count > 1 then
    perform public._award(winner, 'sniper', new.id::text);
  end if;

  -- Host milestones
  select count(*) into wins from public.lots l join public.auctions x on x.id = l.auction_id
   where x.host_id = a.host_id and l.status = 'sold';
  if wins >= 10 then perform public._award(a.host_id, 'seller'); end if;
  if wins >= 100 then perform public._award(a.host_id, 'top_seller'); end if;

  -- Referral: the friend's first win rewards both.
  select referred_by into ref_by from public.profiles where id = winner;
  if ref_by is not null and not exists (select 1 from public.user_badges where user_id = winner and badge = 'welcome') then
    perform public._award(winner, 'welcome');
    perform public._award(ref_by, 'recruiter');
  end if;

  -- Themed events running now whose tag is on this auction.
  for ev in select e.id from public.site_events e
             where now() between e.starts_at and e.ends_at and e.tag = any (coalesce(a.tags, '{}')) loop
    perform public._award(winner, 'event:' || ev.id::text, new.id::text);
  end loop;
  return null;
end;
$$;
revoke execute on function public.engagement_on_close() from public, anon, authenticated;
create trigger lots_engagement after update of status on public.lots
  for each row execute function public.engagement_on_close();

-- Bingo: an honor-system claim from the room (one badge, XP once per auction).
create or replace function public.claim_bingo(p_auction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.auctions;
begin
  select * into a from public.auctions where id = p_auction_id;
  if a.id is null or not public.auction_visible(p_auction_id) or a.status not in ('live', 'paused', 'ended') then
    raise exception 'Auction not found' using errcode = 'P0001';
  end if;
  if not public._fun_on(a.settings, 'bingo') then raise exception 'The host has turned bingo off' using errcode = 'P0001'; end if;
  perform public._award(auth.uid(), 'bingo', p_auction_id::text);
  perform public._grant_xp(auth.uid(), 'bingo:' || p_auction_id::text, 25, 25);
end;
$$;
revoke execute on function public.claim_bingo(uuid) from public, anon;
grant execute on function public.claim_bingo(uuid) to authenticated;

-- ===========================================================================
-- Host tiers, trophy shelf and referrals
-- ===========================================================================
create or replace function public.host_tiers(p_ids uuid[])
returns table (host_id uuid, tier text, sold bigint, rating numeric)
language sql stable security definer set search_path = '' as $$
  with s as (
    select h.id,
           (select count(*) from public.lots l join public.auctions a on a.id = l.auction_id where a.host_id = h.id and l.status = 'sold') as sold,
           (select avg(r.stars) from public.ratings r where r.ratee_id = h.id and r.role = 'seller') as rating,
           (select count(*) from public.ratings r where r.ratee_id = h.id and r.role = 'seller') as n
      from unnest(p_ids[1:200]) h(id)
  )
  select id,
         case when sold >= 50 and n >= 5 and rating >= 4.5 then 'gold'
              when sold >= 10 and (n = 0 or rating >= 4.0) then 'silver'
              when sold >= 1 then 'bronze' end,
         sold, round(rating, 2)
    from s;
$$;
grant execute on function public.host_tiers(uuid[]) to anon, authenticated;

create or replace function public.trophy_shelf(p_user_id uuid)
returns table (lot_id uuid, title text, auction_id uuid, price numeric, currency text, cover text, won_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.id, l.title, a.id, l.current_bid, coalesce(a.settings ->> 'currency', 'INR'),
         (select path from public.lot_media m where m.lot_id = l.id and m.kind = 'image' order by position limit 1),
         l.ends_at
    from public.lots l join public.auctions a on a.id = l.auction_id
   where l.current_winner_id = p_user_id and l.status = 'sold' and a.mode = 'standard' and a.visibility = 'public'
     and (p_user_id = (select auth.uid()) or exists (select 1 from public.profiles p where p.id = p_user_id and p.show_shelf))
   order by l.ends_at desc nulls last
   limit 60;
$$;
grant execute on function public.trophy_shelf(uuid) to anon, authenticated;

create or replace function public.claim_referral(p_username text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me  public.profiles;
  ref uuid;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if me.id is null or me.referred_by is not null or me.created_at < now() - interval '14 days' then return false; end if;
  select id into ref from public.profiles where lower(username) = lower(btrim(ltrim(p_username, '@')));
  if ref is null or ref = me.id then return false; end if;
  update public.profiles set referred_by = ref where id = me.id;
  return true;
end;
$$;
revoke execute on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- ===========================================================================
-- Watch parties: a private group chat inside an auction
-- ===========================================================================
create table public.watch_parties (
  id          uuid primary key default gen_random_uuid(),
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 40),
  code        text not null unique default substr(md5(gen_random_uuid()::text), 1, 8),
  created_at  timestamptz not null default now()
);
create table public.watch_party_members (
  party_id   uuid not null references public.watch_parties (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (party_id, user_id)
);
create table public.watch_party_messages (
  id          bigint generated always as identity primary key,
  party_id    uuid not null references public.watch_parties (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 300),
  created_at  timestamptz not null default now()
);
create index watch_party_messages_idx on public.watch_party_messages (party_id, created_at desc);

create or replace function public.is_party_member(p_party_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.watch_party_members m where m.party_id = p_party_id and m.user_id = (select auth.uid()));
$$;
grant execute on function public.is_party_member(uuid) to authenticated;

alter table public.watch_parties enable row level security;
alter table public.watch_party_members enable row level security;
alter table public.watch_party_messages enable row level security;
revoke all on public.watch_parties, public.watch_party_members, public.watch_party_messages from anon, authenticated;
grant select on public.watch_parties, public.watch_party_members to authenticated;
grant select, insert on public.watch_party_messages to authenticated;
grant delete on public.watch_party_members, public.watch_parties to authenticated;
create policy "parties for members" on public.watch_parties for select to authenticated using (public.is_party_member(id));
create policy "parties owner delete" on public.watch_parties for delete to authenticated using (owner_id = (select auth.uid()));
create policy "members for members" on public.watch_party_members for select to authenticated using (public.is_party_member(party_id));
create policy "members leave or kicked" on public.watch_party_members for delete to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.watch_parties p where p.id = party_id and p.owner_id = (select auth.uid())));
create policy "messages for members" on public.watch_party_messages for select to authenticated using (public.is_party_member(party_id));
create policy "members send" on public.watch_party_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_party_member(party_id));
alter publication supabase_realtime add table public.watch_party_messages;

create or replace function public.create_watch_party(p_auction_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a  public.auctions;
  wp public.watch_parties;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  select * into a from public.auctions where id = p_auction_id;
  if a.id is null or not public.auction_visible(p_auction_id) then raise exception 'Auction not found' using errcode = 'P0001'; end if;
  if not public._fun_on(a.settings, 'parties') then raise exception 'The host has turned watch parties off' using errcode = 'P0001'; end if;
  if (select count(*) from public.watch_parties where auction_id = p_auction_id and owner_id = auth.uid()) >= 3 then
    raise exception 'Up to 3 parties per auction' using errcode = 'P0001';
  end if;
  insert into public.watch_parties (auction_id, owner_id, name) values (p_auction_id, auth.uid(), btrim(p_name)) returning * into wp;
  insert into public.watch_party_members (party_id, user_id) values (wp.id, auth.uid());
  return jsonb_build_object('id', wp.id, 'code', wp.code);
end;
$$;

create or replace function public.join_watch_party(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  wp public.watch_parties;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  select * into wp from public.watch_parties where code = lower(btrim(p_code));
  if wp.id is null or not public.auction_visible(wp.auction_id) then raise exception 'Party not found' using errcode = 'P0001'; end if;
  if (select count(*) from public.watch_party_members where party_id = wp.id) >= 20 then
    raise exception 'This party is full' using errcode = 'P0001';
  end if;
  insert into public.watch_party_members (party_id, user_id) values (wp.id, auth.uid()) on conflict do nothing;
  return wp.id;
end;
$$;
revoke execute on function public.create_watch_party(uuid, text), public.join_watch_party(text) from public, anon;
grant execute on function public.create_watch_party(uuid, text), public.join_watch_party(text) to authenticated;

-- ===========================================================================
-- Reminders and saved searches
-- ===========================================================================
create table public.auction_reminders (
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  primary key (auction_id, user_id)
);
alter table public.auction_reminders enable row level security;
revoke all on public.auction_reminders from anon, authenticated;
grant select, insert, delete on public.auction_reminders to authenticated;
create policy "own reminders" on public.auction_reminders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.auction_visible(auction_id));

create table public.saved_searches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  query       text not null default '' check (char_length(query) <= 80),
  category    text check (category is null or char_length(category) <= 40),
  max_price   numeric(12, 2) check (max_price is null or max_price > 0),
  last_sent   timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  check (btrim(query) <> '' or category is not null)
);
alter table public.saved_searches enable row level security;
revoke all on public.saved_searches from anon, authenticated;
grant select, delete on public.saved_searches to authenticated;
grant insert (query, category, max_price) on public.saved_searches to authenticated;
create policy "own searches" on public.saved_searches for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.guard_saved_search()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.user_id := auth.uid();
  if (select count(*) from public.saved_searches where user_id = new.user_id) >= 10 then
    raise exception 'Up to 10 saved searches' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_saved_search() from public, anon, authenticated;
create trigger saved_searches_guard before insert on public.saved_searches for each row execute function public.guard_saved_search();

-- ===========================================================================
-- League: fixtures (head-to-head weeks) and a trade deadline
-- ===========================================================================
alter table public.league_matches add column week int check (week is null or week between 1 and 100);

create table public.league_fixtures (
  id         uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  week       int not null check (week between 1 and 100),
  starts_on  date not null,
  team_a     uuid not null references public.league_teams (id) on delete cascade,
  team_b     uuid references public.league_teams (id) on delete cascade,   -- null: bye
  unique (auction_id, week, team_a)
);
alter table public.league_fixtures enable row level security;
revoke all on public.league_fixtures from anon, authenticated;
grant select on public.league_fixtures to anon, authenticated;
create policy "fixtures readable" on public.league_fixtures for select using (public.auction_visible(auction_id));

-- Round robin by the circle method; one week per round.
create or replace function public.league_generate_fixtures(p_auction_id uuid, p_first date, p_days_between int)
returns int language plpgsql security definer set search_path = '' as $$
declare
  a      public.auctions := public._assert_host(p_auction_id);
  ids    uuid[];
  n      int;
  r      int;
  i      int;
  x      uuid;
  y      uuid;
  rounds int;
begin
  if a.mode <> 'league' then raise exception 'Fixtures are for leagues' using errcode = 'P0001'; end if;
  if p_days_between not between 1 and 60 then raise exception 'Weeks must be 1 to 60 days apart' using errcode = 'P0001'; end if;
  select array_agg(id order by created_at) into ids from public.league_teams where auction_id = p_auction_id;
  if coalesce(array_length(ids, 1), 0) < 2 then raise exception 'Add at least two teams first' using errcode = 'P0001'; end if;
  if array_length(ids, 1) % 2 = 1 then ids := ids || null::uuid; end if;
  n := array_length(ids, 1);
  rounds := n - 1;
  delete from public.league_fixtures where auction_id = p_auction_id;
  for r in 1..rounds loop
    for i in 1..(n / 2) loop
      x := ids[i];
      y := ids[n + 1 - i];
      if x is null then x := y; y := null; end if;
      if x is not null then
        insert into public.league_fixtures (auction_id, week, starts_on, team_a, team_b)
        values (p_auction_id, r, p_first + (r - 1) * p_days_between, x, y);
      end if;
    end loop;
    -- Rotate everything but the first slot.
    ids := ids[1:1] || ids[n:n] || ids[2:n - 1];
  end loop;
  return rounds;
end;
$$;
revoke execute on function public.league_generate_fixtures(uuid, date, int) from public, anon;
grant execute on function public.league_generate_fixtures(uuid, date, int) to authenticated;

-- A recorded match joins the latest week that has started by its date.
create or replace function public.default_match_week()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.week is null then
    select max(f.week) into new.week from public.league_fixtures f where f.auction_id = new.auction_id and f.starts_on <= new.played_on;
  end if;
  return new;
end;
$$;
revoke execute on function public.default_match_week() from public, anon, authenticated;
create trigger league_matches_week before insert on public.league_matches for each row execute function public.default_match_week();

create or replace function public.league_set_match_week(p_match_id uuid, p_week int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.league_matches;
begin
  select * into m from public.league_matches where id = p_match_id;
  if m.id is null then raise exception 'Match not found' using errcode = 'P0001'; end if;
  perform public._assert_host(m.auction_id);
  update public.league_matches set week = p_week where id = p_match_id;
end;
$$;
revoke execute on function public.league_set_match_week(uuid, int) from public, anon;
grant execute on function public.league_set_match_week(uuid, int) to authenticated;

-- Trade deadline (settings.league.trade_deadline, an ISO time).
create or replace function public.guard_trade_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  dl timestamptz;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  if tg_op = 'UPDATE' and new.status <> 'accepted' then return new; end if;
  select nullif(a.settings -> 'league' ->> 'trade_deadline', '')::timestamptz into dl from public.auctions a where a.id = new.auction_id;
  if dl is not null and now() > dl then
    raise exception 'The trade deadline has passed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_trade_deadline() from public, anon, authenticated;
create trigger league_trades_deadline before insert or update of status on public.league_trades
  for each row execute function public.guard_trade_deadline();

-- ===========================================================================
-- Scheduled reminders: auctions starting soon, league weeks, saved searches
-- ===========================================================================
create or replace function public.send_reminders()
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  -- "Starting in 10 minutes"
  for r in
    select ar.auction_id, ar.user_id, a.title from public.auction_reminders ar
      join public.auctions a on a.id = ar.auction_id
     where ar.sent_at is null and a.status = 'scheduled' and a.starts_at <= now() + interval '10 minutes'
     for update of ar skip locked
  loop
    perform public._notify(r.user_id, 'reminder', 'Starting soon: ' || left(r.title, 100), 'Starts within 10 minutes.', '/a/' || r.auction_id, 'remind:' || r.auction_id);
    update public.auction_reminders set sent_at = now() where auction_id = r.auction_id and user_id = r.user_id;
  end loop;

  -- League week starts tomorrow: team owners pick captains.
  for r in
    select distinct f.auction_id, f.week, t.owner_id from public.league_fixtures f
      join public.league_teams t on t.id in (f.team_a, f.team_b)
     where f.starts_on = (now() at time zone 'Asia/Kolkata')::date + 1
  loop
    perform public._notify(r.owner_id, 'reminder', 'Match week ' || r.week || ' starts tomorrow', 'Pick your captain and vice-captain.',
      '/a/' || r.auction_id, 'week:' || r.auction_id || ':' || r.week);
  end loop;

  -- Saved searches: new public lots since the last alert, checked every 15 minutes.
  for r in
    select s.id, s.user_id, s.query, count(l.id) as n, min(a.id::text) as auction_id
      from public.saved_searches s
      join public.auctions a on a.visibility = 'public' and a.status in ('scheduled', 'live') and a.created_at > s.last_sent
      join public.lots l on l.auction_id = a.id
     where s.last_sent < now() - interval '15 minutes'
       and (s.category is null or a.category = s.category)
       and (btrim(s.query) = '' or l.title ilike '%' || btrim(s.query) || '%' or a.title ilike '%' || btrim(s.query) || '%')
       and (s.max_price is null or l.start_price <= s.max_price)
     group by s.id, s.user_id, s.query
  loop
    perform public._notify(r.user_id, 'system', 'New lots for "' || left(coalesce(nullif(btrim(r.query), ''), 'your search'), 60) || '"',
      r.n || ' new matching lots.', '/a/' || r.auction_id, null);
    update public.saved_searches set last_sent = now() where id = r.id;
  end loop;
end;
$$;
revoke execute on function public.send_reminders() from public, anon, authenticated;
select cron.schedule('send-reminders', '* * * * *', $$select public.send_reminders()$$);
