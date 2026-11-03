-- Public / unlisted / private auctions, host delete, and data retention.
--
-- visibility:
--   public    listed on the home page, anyone can view and take part
--   unlisted  not listed; anyone with the link can view and take part
--   private   only the host, moderators and members who joined with the invite code

-- ---------------------------------------------------------------------------
-- Visibility + membership
-- ---------------------------------------------------------------------------
alter table public.auctions
  add column visibility text not null default 'public' check (visibility in ('public', 'unlisted', 'private'));
create index auctions_listing_idx on public.auctions (visibility, status, starts_at);
grant insert (visibility), update (visibility) on public.auctions to authenticated;

create table public.auction_members (
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (auction_id, user_id)
);
create index auction_members_user_idx on public.auction_members (user_id);

-- Invite codes live apart from auctions so members can't read them.
create table public.auction_secrets (
  auction_id   uuid primary key references public.auctions (id) on delete cascade,
  invite_code  text not null
);

alter table public.auction_members enable row level security;
alter table public.auction_secrets enable row level security;
revoke all on public.auction_members, public.auction_secrets from anon, authenticated;

create policy "members visible to staff or self" on public.auction_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_auction_staff(auction_id));
create policy "members removable by host or self" on public.auction_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_auction_host(auction_id));
grant select, delete on public.auction_members to authenticated;
-- auction_secrets: no policies, no grants; only security-definer functions touch it.

-- Central visibility rule used by every RLS policy that calls auction_visible().
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
       and (
         a.host_id = (select auth.uid())
         or (
           a.status <> 'draft'
           and (
             a.visibility <> 'private'
             or exists (select 1 from public.auction_members m where m.auction_id = a.id and m.user_id = (select auth.uid()))
             or exists (select 1 from public.auction_moderators m where m.auction_id = a.id and m.user_id = (select auth.uid()))
           )
         )
       )
  );
$$;

-- Membership only (no lookup of the auction row itself), so the auctions
-- policy below also works for a row being inserted (INSERT ... RETURNING).
create or replace function public.is_auction_member(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.auction_members m where m.auction_id = p_auction_id and m.user_id = (select auth.uid()))
      or exists (select 1 from public.auction_moderators m where m.auction_id = p_auction_id and m.user_id = (select auth.uid()));
$$;

drop policy "auctions readable" on public.auctions;
create policy "auctions readable" on public.auctions for select
  using (
    host_id = (select auth.uid())
    or (status <> 'draft' and (visibility <> 'private' or public.is_auction_member(id)))
  );

-- Minimal public card for a private auction so the invite page can render.
create or replace function public.auction_preview(p_auction_id uuid)
returns table (id uuid, title text, cover_url text, visibility text, status public.auction_status, host_name text, can_view boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, a.cover_url, a.visibility, a.status, p.display_name, public.auction_visible(a.id)
    from public.auctions a
    join public.profiles p on p.id = a.host_id
   where a.id = p_auction_id and (a.status <> 'draft' or a.host_id = (select auth.uid()));
$$;

create or replace function public.get_invite_code(p_auction_id uuid, p_regenerate boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text;
begin
  perform public._assert_host(p_auction_id);
  select invite_code into code from public.auction_secrets where auction_id = p_auction_id;
  if code is null or p_regenerate then
    code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
    insert into public.auction_secrets (auction_id, invite_code) values (p_auction_id, code)
    on conflict (auction_id) do update set invite_code = excluded.invite_code;
  end if;
  return code;
end;
$$;

create or replace function public.join_private_auction(p_auction_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in to join this auction' using errcode = 'P0001';
  end if;
  if public.auction_visible(p_auction_id) then
    return true;
  end if;
  if not exists (
    select 1 from public.auction_secrets s
      join public.auctions a on a.id = s.auction_id
     where s.auction_id = p_auction_id and a.status <> 'draft'
       and s.invite_code = upper(btrim(coalesce(p_code, '')))
  ) then
    raise exception 'That invite code is not valid' using errcode = 'P0001';
  end if;
  insert into public.auction_members (auction_id, user_id) values (p_auction_id, uid) on conflict do nothing;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Participation checks: private auctions block non-members everywhere
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
  if not public.auction_visible(a.id) then
    raise exception 'This auction is private' using errcode = 'P0001';
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

-- Guard league entry points and chat with the same rule.
create or replace function public.guard_private_participation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.auction_visible(new.auction_id) then
    raise exception 'This auction is private' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger league_teams_private_guard before insert on public.league_teams
  for each row execute function public.guard_private_participation();
create trigger chat_private_guard before insert on public.chat_messages
  for each row when (new.kind = 'text') execute function public.guard_private_participation();

-- league_bid: block non-members of private leagues (teams already require membership to join).
create or replace function public.guard_private_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  aid uuid;
begin
  select auction_id into aid from public.lots where id = new.lot_id;
  if new.bidder_id = (select auth.uid()) and not public.auction_visible(aid) then
    raise exception 'This auction is private' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger bids_private_guard before insert on public.bids
  for each row execute function public.guard_private_bid();

-- ---------------------------------------------------------------------------
-- Host delete (draft, ended or cancelled). Rows cascade; the client removes
-- storage files first, and the orphan sweep catches anything left behind.
-- ---------------------------------------------------------------------------
create or replace function public.delete_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions := public._assert_host(p_auction_id);
begin
  if a.status not in ('draft', 'ended', 'cancelled') then
    raise exception 'End or cancel the auction before deleting it' using errcode = 'P0001';
  end if;
  delete from public.auctions where id = p_auction_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily retention job: keeps the free-tier database small.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_stale_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_cron int; n_chat_del int; n_chat_old int; n_proxy int; n_bids int; n_deal int; n_cancelled int; n_drafts int;
begin
  -- pg_cron writes a log row per run (about 5,800/day at 15s): keep 1 day.
  delete from cron.job_run_details where end_time < now() - interval '1 day';
  get diagnostics n_cron = row_count;

  -- Moderated (soft-deleted) chat messages.
  delete from public.chat_messages where deleted_at < now() - interval '1 day';
  get diagnostics n_chat_del = row_count;

  -- Chat of auctions finished more than 30 days ago.
  delete from public.chat_messages c using public.auctions a
   where a.id = c.auction_id and a.status in ('ended', 'cancelled') and a.ends_at < now() - interval '30 days';
  get diagnostics n_chat_old = row_count;

  -- Proxy ceilings are useless once a lot is closed.
  delete from public.proxy_bids pb using public.lots l
   where l.id = pb.lot_id and l.status in ('sold', 'unsold', 'withdrawn') and l.ends_at < now() - interval '7 days';
  get diagnostics n_proxy = row_count;

  -- Bid history of auctions finished more than 90 days ago: keep only each lot's final bid.
  delete from public.bids b using public.lots l, public.auctions a
   where l.id = b.lot_id and a.id = l.auction_id
     and a.status in ('ended', 'cancelled') and a.ends_at < now() - interval '90 days'
     and b.id <> (select max(b2.id) from public.bids b2 where b2.lot_id = b.lot_id);
  get diagnostics n_bids = row_count;

  -- Deal chats 180 days after the sale.
  delete from public.deal_messages d using public.lots l
   where l.id = d.lot_id and l.ends_at < now() - interval '180 days';
  get diagnostics n_deal = row_count;

  -- Cancelled auctions after 30 days, and empty drafts untouched for 30 days.
  delete from public.auctions where status = 'cancelled' and updated_at < now() - interval '30 days';
  get diagnostics n_cancelled = row_count;
  delete from public.auctions a
   where a.status = 'draft' and a.updated_at < now() - interval '30 days'
     and not exists (select 1 from public.lots l where l.auction_id = a.id);
  get diagnostics n_drafts = row_count;

  return jsonb_build_object('cron_logs', n_cron, 'chat_moderated', n_chat_del, 'chat_old', n_chat_old,
    'proxy_bids', n_proxy, 'bids_compacted', n_bids, 'deal_messages', n_deal,
    'cancelled_auctions', n_cancelled, 'empty_drafts', n_drafts);
end;
$$;

-- Storage files no longer referenced by any row (deleted auctions/lots,
-- replaced covers and avatars). Older than 1 day so in-flight uploads are safe.
-- Only the service role may call this (used by the Worker's cleanup cron).
create or replace function public.storage_orphans(p_limit int default 500)
returns table (bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.created_at < now() - interval '1 day'
     and (
       (o.bucket_id = 'lot-media' and not exists (select 1 from public.lot_media m where m.path = o.name))
       or (o.bucket_id = 'auction-branding' and not exists (
             select 1 from public.auctions a where a.cover_url like '%/auction-branding/' || o.name))
       or (o.bucket_id = 'avatars' and not exists (
             select 1 from public.profiles p where p.avatar_url like '%/avatars/' || o.name))
     )
   limit greatest(1, least(p_limit, 1000));
$$;

-- ---------------------------------------------------------------------------
-- Privileges + schedule
-- ---------------------------------------------------------------------------
revoke execute on function
  public.cleanup_stale_data(),
  public.storage_orphans(int),
  public.guard_private_participation(),
  public.guard_private_bid()
from public, anon, authenticated;
grant execute on function public.storage_orphans(int) to service_role;

revoke execute on function
  public.get_invite_code(uuid, boolean),
  public.join_private_auction(uuid, text),
  public.delete_auction(uuid)
from public, anon;
grant execute on function
  public.get_invite_code(uuid, boolean),
  public.join_private_auction(uuid, text),
  public.delete_auction(uuid)
to authenticated;
grant execute on function public.auction_preview(uuid) to anon, authenticated;

select cron.schedule('cleanup-stale-data', '17 3 * * *', $$select public.cleanup_stale_data()$$);
