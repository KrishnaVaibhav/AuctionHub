-- AuctionHub core schema: profiles, auctions, lots, bids, chat, media, moderation.
-- Status changes and bids happen only through security-definer functions
-- (see 20261103000002_auction_logic.sql). Clients get column-level grants only.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.auction_status as enum ('draft', 'scheduled', 'live', 'paused', 'ended', 'cancelled');
create type public.lot_status     as enum ('pending', 'open', 'sold', 'unsold', 'withdrawn');
create type public.chat_kind      as enum ('text', 'bid', 'system');

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text unique not null check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  display_name  text not null check (char_length(display_name) between 1 and 50),
  avatar_url    text,
  banned_until  timestamptz,
  created_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
begin
  base := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(base) < 3 then
    base := 'user';
  end if;
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    left(base, 17) || '_' || substr(replace(new.id::text, '-', ''), 1, 6),
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), left(base, 50))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Auctions
-- ---------------------------------------------------------------------------
create table public.auctions (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null references public.profiles (id) on delete cascade,
  title        text not null check (char_length(title) between 3 and 120),
  description  text not null default '' check (char_length(description) <= 5000),
  status       public.auction_status not null default 'draft',
  starts_at    timestamptz,
  ends_at      timestamptz,
  paused_at    timestamptz,
  -- See docs/ARCHITECTURE.md for keys: increments, anti_snipe_seconds,
  -- lot_stagger_seconds, chat.{enabled, slow_mode_s}, currency, theme.
  settings     jsonb not null default '{}'::jsonb,
  cover_url    text,
  stream_url   text check (stream_url is null or stream_url ~ '^https://'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);
create index auctions_host_idx on public.auctions (host_id);
create index auctions_status_starts_idx on public.auctions (status, starts_at);

create table public.auction_moderators (
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  primary key (auction_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Lots
-- ---------------------------------------------------------------------------
create table public.lots (
  id                 uuid primary key default gen_random_uuid(),
  auction_id         uuid not null references public.auctions (id) on delete cascade,
  position           int not null default 0,
  title              text not null check (char_length(title) between 1 and 120),
  description        text not null default '' check (char_length(description) <= 5000),
  start_price        numeric(12, 2) not null check (start_price >= 0),
  buy_now_price      numeric(12, 2) check (buy_now_price is null or buy_now_price > start_price),
  custom_fields      jsonb not null default '{}'::jsonb,
  status             public.lot_status not null default 'pending',
  current_bid        numeric(12, 2),
  current_winner_id  uuid references public.profiles (id),
  bid_count          int not null default 0,
  reserve_met        boolean not null default true,
  opens_at           timestamptz,
  ends_at            timestamptz,
  created_at         timestamptz not null default now()
);
create index lots_auction_idx on public.lots (auction_id, position);
create index lots_due_idx on public.lots (ends_at) where status = 'open';

-- Reserve price is secret: separate table, host-only.
create table public.lot_reserves (
  lot_id         uuid primary key references public.lots (id) on delete cascade,
  reserve_price  numeric(12, 2) not null check (reserve_price > 0)
);

create table public.lot_media (
  id          uuid primary key default gen_random_uuid(),
  lot_id      uuid not null references public.lots (id) on delete cascade,
  path        text not null,           -- storage path inside bucket lot-media
  kind        text not null check (kind in ('image', 'video')),
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index lot_media_lot_idx on public.lot_media (lot_id, position);

-- ---------------------------------------------------------------------------
-- Bids
-- ---------------------------------------------------------------------------
create table public.bids (
  id          bigint generated always as identity primary key,
  lot_id      uuid not null references public.lots (id) on delete cascade,
  bidder_id   uuid not null references public.profiles (id),
  amount      numeric(12, 2) not null check (amount > 0),
  is_auto     boolean not null default false,   -- placed by proxy (auto-bid)
  created_at  timestamptz not null default now()
);
create index bids_lot_idx on public.bids (lot_id, created_at desc);
create index bids_bidder_idx on public.bids (bidder_id, created_at desc);

-- Proxy (max) bids: private to each bidder.
create table public.proxy_bids (
  lot_id      uuid not null references public.lots (id) on delete cascade,
  bidder_id   uuid not null references public.profiles (id) on delete cascade,
  max_amount  numeric(12, 2) not null check (max_amount > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (lot_id, bidder_id)
);

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------
create table public.chat_messages (
  id          bigint generated always as identity primary key,
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  kind        public.chat_kind not null default 'text',
  body        text not null check (char_length(body) between 1 and 500),
  pinned      boolean not null default false,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index chat_auction_idx on public.chat_messages (auction_id, created_at desc);

create table public.chat_mutes (
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  until       timestamptz not null,
  created_by  uuid not null references public.profiles (id),
  primary key (auction_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Watchlist
-- ---------------------------------------------------------------------------
create table public.watchlist (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  lot_id      uuid not null references public.lots (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, lot_id)
);

-- ---------------------------------------------------------------------------
-- Helpers used by policies
-- ---------------------------------------------------------------------------
create or replace function public.is_auction_host(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id and a.host_id = (select auth.uid())
  );
$$;

create or replace function public.is_auction_staff(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_auction_host(p_auction_id)
      or exists (
        select 1 from public.auction_moderators m
        where m.auction_id = p_auction_id and m.user_id = (select auth.uid())
      );
$$;

create or replace function public.auction_visible(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id
      and (a.status <> 'draft' or a.host_id = (select auth.uid()))
  );
$$;

create or replace function public.auction_editable(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.auctions a
    where a.id = p_auction_id
      and a.host_id = (select auth.uid())
      and a.status in ('draft', 'scheduled')
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger auctions_touch before update on public.auctions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.auctions            enable row level security;
alter table public.auction_moderators  enable row level security;
alter table public.lots                enable row level security;
alter table public.lot_reserves        enable row level security;
alter table public.lot_media           enable row level security;
alter table public.bids                enable row level security;
alter table public.proxy_bids          enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.chat_mutes          enable row level security;
alter table public.watchlist           enable row level security;

-- profiles
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles self update" on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- auctions
create policy "auctions readable" on public.auctions for select
  using (status <> 'draft' or host_id = (select auth.uid()));
create policy "auctions host insert" on public.auctions for insert to authenticated
  with check (host_id = (select auth.uid()) and status = 'draft');
create policy "auctions host update" on public.auctions for update to authenticated
  using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));
create policy "auctions host delete draft" on public.auctions for delete to authenticated
  using (host_id = (select auth.uid()) and status = 'draft');

-- moderators
create policy "moderators readable" on public.auction_moderators for select using (true);
create policy "moderators host manage" on public.auction_moderators for all to authenticated
  using (public.is_auction_host(auction_id)) with check (public.is_auction_host(auction_id));

-- lots
create policy "lots readable" on public.lots for select using (public.auction_visible(auction_id));
create policy "lots host insert" on public.lots for insert to authenticated
  with check (public.auction_editable(auction_id));
create policy "lots host update" on public.lots for update to authenticated
  using (public.auction_editable(auction_id)) with check (public.auction_editable(auction_id));
create policy "lots host delete" on public.lots for delete to authenticated
  using (public.auction_editable(auction_id));

-- lot reserves (host only)
create policy "reserves host all" on public.lot_reserves for all to authenticated
  using (exists (select 1 from public.lots l where l.id = lot_id and public.is_auction_host(l.auction_id)))
  with check (exists (select 1 from public.lots l where l.id = lot_id and public.auction_editable(l.auction_id)));

-- lot media
create policy "media readable" on public.lot_media for select
  using (exists (select 1 from public.lots l where l.id = lot_id and public.auction_visible(l.auction_id)));
create policy "media host insert" on public.lot_media for insert to authenticated
  with check (exists (select 1 from public.lots l where l.id = lot_id and public.is_auction_host(l.auction_id)));
create policy "media host delete" on public.lot_media for delete to authenticated
  using (exists (select 1 from public.lots l where l.id = lot_id and public.is_auction_host(l.auction_id)));

-- bids: public history, writes only via place_bid()
create policy "bids readable" on public.bids for select
  using (exists (select 1 from public.lots l where l.id = lot_id and public.auction_visible(l.auction_id)));

-- proxy bids: owner only, writes only via place_bid()
create policy "proxy own read" on public.proxy_bids for select to authenticated
  using (bidder_id = (select auth.uid()));

-- chat
create policy "chat readable" on public.chat_messages for select
  using (public.auction_visible(auction_id));
create policy "chat send" on public.chat_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and kind = 'text'
    and pinned = false
    and deleted_at is null
  );
create policy "chat staff moderate" on public.chat_messages for update to authenticated
  using (public.is_auction_staff(auction_id)) with check (public.is_auction_staff(auction_id));

-- mutes
create policy "mutes readable by staff or self" on public.chat_mutes for select to authenticated
  using (user_id = (select auth.uid()) or public.is_auction_staff(auction_id));
create policy "mutes staff manage" on public.chat_mutes for all to authenticated
  using (public.is_auction_staff(auction_id))
  with check (public.is_auction_staff(auction_id) and created_by = (select auth.uid()));

-- watchlist
create policy "watchlist own" on public.watchlist for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Column-level write grants (status, prices, winners only change via functions)
-- ---------------------------------------------------------------------------
revoke insert, update on public.profiles from anon, authenticated;
grant update (username, display_name, avatar_url) on public.profiles to authenticated;

revoke insert, update on public.auctions from anon, authenticated;
grant insert (id, host_id, title, description, starts_at, ends_at, settings, cover_url, stream_url)
  on public.auctions to authenticated;
grant update (title, description, starts_at, ends_at, settings, cover_url, stream_url)
  on public.auctions to authenticated;

revoke insert, update on public.lots from anon, authenticated;
grant insert (id, auction_id, position, title, description, start_price, buy_now_price, custom_fields)
  on public.lots to authenticated;
grant update (position, title, description, start_price, buy_now_price, custom_fields)
  on public.lots to authenticated;

revoke all on public.bids, public.proxy_bids from anon, authenticated;
grant select on public.bids to anon, authenticated;
grant select on public.proxy_bids to authenticated;

revoke insert, update on public.chat_messages from anon, authenticated;
grant insert (auction_id, user_id, body) on public.chat_messages to authenticated;
grant update (pinned, deleted_at) on public.chat_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Chat guard: auction state, chat enabled, mutes, bans, slow mode
-- ---------------------------------------------------------------------------
create or replace function public.chat_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a        public.auctions;
  slow     int;
  last_at  timestamptz;
begin
  if new.kind <> 'text' then
    return new;  -- system/bid messages come from trusted functions
  end if;

  select * into a from public.auctions where id = new.auction_id;
  if a.id is null or a.status not in ('scheduled', 'live', 'paused') then
    raise exception 'Chat is closed for this auction' using errcode = 'P0001';
  end if;
  if coalesce((a.settings -> 'chat' ->> 'enabled')::boolean, true) = false then
    raise exception 'Chat is disabled by the host' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles p where p.id = new.user_id and p.banned_until > now()) then
    raise exception 'Your account is suspended' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.chat_mutes m
             where m.auction_id = new.auction_id and m.user_id = new.user_id and m.until > now()) then
    raise exception 'You are muted in this auction' using errcode = 'P0001';
  end if;

  if not public.is_auction_staff(new.auction_id) then
    slow := coalesce((a.settings -> 'chat' ->> 'slow_mode_s')::int, 2);
    select max(created_at) into last_at from public.chat_messages
      where auction_id = new.auction_id and user_id = new.user_id;
    if last_at is not null and last_at > now() - make_interval(secs => slow) then
      raise exception 'Slow mode: wait % seconds between messages', slow using errcode = 'P0001';
    end if;
  end if;

  new.body := btrim(new.body);
  return new;
end;
$$;

create trigger chat_guard before insert on public.chat_messages
  for each row execute function public.chat_guard();

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.lots, public.chat_messages, public.auctions;
