-- In-app notifications (bell + realtime) and following hosts.
-- Producers are triggers/cron inside the database, so no external service is needed.

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('outbid', 'won', 'sold', 'unsold', 'closing', 'live', 'deal', 'system')),
  title       text not null check (char_length(title) <= 140),
  body        text not null default '' check (char_length(body) <= 400),
  link        text check (link is null or link ~ '^/'),
  ref         text,               -- de-duplication key (e.g. lot id for "closing soon")
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create unique index notifications_dedupe_idx on public.notifications (user_id, kind, ref) where ref is not null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy "own notifications read" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "own notifications update" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own notifications delete" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
alter publication supabase_realtime add table public.notifications;

create table public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  host_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, host_id),
  check (follower_id <> host_id)
);
create index follows_host_idx on public.follows (host_id);
alter table public.follows enable row level security;
revoke all on public.follows from anon, authenticated;
grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;
create policy "follows readable" on public.follows for select using (true);
create policy "follow as self" on public.follows for insert to authenticated with check (follower_id = (select auth.uid()));
create policy "unfollow as self" on public.follows for delete to authenticated using (follower_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Producer helper
-- ---------------------------------------------------------------------------
create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_ref text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, ref)
  values (p_user, p_kind, left(p_title, 140), left(coalesce(p_body, ''), 400), p_link, p_ref)
  on conflict do nothing;
$$;

-- Lot changes: outbid, won/sold/unsold.
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
      '/a/' || a.id);
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
create trigger lots_notify after update of current_winner_id, status on public.lots
  for each row execute function public.notify_lot_change();

-- Auction goes live: followers of the host, watchers of its lots, and private members.
create or replace function public.notify_auction_live()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  host_name text;
begin
  if new.status = 'live' and old.status in ('draft', 'scheduled') then
    select display_name into host_name from public.profiles where id = new.host_id;
    insert into public.notifications (user_id, kind, title, body, link, ref)
    select distinct u, 'live', format('"%s" is live', new.title), format('%s started the auction. Join the room.', host_name),
           '/a/' || new.id, 'live:' || new.id
      from (
        select f.follower_id as u from public.follows f where f.host_id = new.host_id and new.visibility = 'public'
        union select w.user_id from public.watchlist w join public.lots l on l.id = w.lot_id where l.auction_id = new.id
        union select m.user_id from public.auction_members m where m.auction_id = new.id
        union select t.owner_id from public.league_teams t where t.auction_id = new.id
      ) x
     where u <> new.host_id
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger auctions_notify_live after update of status on public.auctions
  for each row execute function public.notify_auction_live();

-- Deal chat: tell the other party.
create or replace function public.notify_deal_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.lots;
  host uuid;
  other uuid;
begin
  select * into l from public.lots where id = new.lot_id;
  select host_id into host from public.auctions where id = l.auction_id;
  other := case when new.sender_id = host then l.current_winner_id else host end;
  if other is not null then
    perform public._notify(other, 'deal', format('New message about "%s"', l.title), left(new.body, 140),
      case when other = host then '/a/' || l.auction_id || '?tab=results' else '/me' end);
  end if;
  return null;
end;
$$;
create trigger deal_messages_notify after insert on public.deal_messages
  for each row execute function public.notify_deal_message();

-- Watched lots closing within 5 minutes (once per user per lot).
create or replace function public.notify_closing_soon()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, ref)
  select w.user_id, 'closing', format('"%s" closes soon', l.title),
         format('Current bid %s. Last chance to bid.', public.format_money(coalesce(l.current_bid, l.start_price), a.settings)),
         '/a/' || a.id, 'closing:' || l.id
    from public.watchlist w
    join public.lots l on l.id = w.lot_id
    join public.auctions a on a.id = l.auction_id
   where l.status = 'open' and a.status = 'live'
     and l.ends_at between now() and now() + interval '5 minutes'
     and w.user_id is distinct from l.current_winner_id
  on conflict do nothing;
$$;

revoke execute on function
  public._notify(uuid, text, text, text, text, text),
  public.notify_lot_change(),
  public.notify_auction_live(),
  public.notify_deal_message(),
  public.notify_closing_soon()
from public, anon, authenticated;

select cron.schedule('notify-closing-soon', '* * * * *', $$select public.notify_closing_soon()$$);
select cron.schedule('cleanup-notifications', '37 3 * * *',
  $$delete from public.notifications where (read_at is not null and created_at < now() - interval '30 days') or created_at < now() - interval '90 days'$$);
