-- Safety: chat word filter + link blocking, and admin fraud signals.

create table public.blocked_words (
  word        text primary key check (word = lower(btrim(word)) and char_length(word) between 2 and 40),
  created_at  timestamptz not null default now()
);
alter table public.blocked_words enable row level security;
revoke all on public.blocked_words from anon, authenticated;
grant select, insert, delete on public.blocked_words to authenticated;
create policy "admin manages blocked words" on public.blocked_words for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Runs after chat_guard (alphabetical trigger order: chat_guard < chat_private_guard < chat_zfilter).
create or replace function public.chat_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a   public.auctions;
  w   text;
begin
  if new.kind <> 'text' then
    return new;
  end if;
  select * into a from public.auctions where id = new.auction_id;

  -- Links (common scam vector) are blocked unless the host allows them; staff may always post links.
  if coalesce((a.settings -> 'chat' ->> 'allow_links')::boolean, false) = false
     and not public.is_auction_staff(new.auction_id)
     and new.body ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|in|net|org|xyz|io|me|ly|link|app)\M|t\.me/|wa\.me/)' then
    raise exception 'Links are not allowed in this chat' using errcode = 'P0001';
  end if;

  -- Mask blocked words (whole words, case-insensitive).
  for w in select word from public.blocked_words loop
    new.body := regexp_replace(new.body, '\m' || regexp_replace(w, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M', repeat('*', char_length(w)), 'gi');
  end loop;
  return new;
end;
$$;
create trigger chat_zfilter before insert on public.chat_messages
  for each row execute function public.chat_filter();
revoke execute on function public.chat_filter() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fraud signals for the admin dashboard
-- ---------------------------------------------------------------------------
create or replace function public.admin_fraud_signals()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_platform_admin();
  return jsonb_build_object(
    -- Bidders who share a sign-in IP address with the host of an auction they bid in.
    'shared_ip_with_host', (select coalesce(jsonb_agg(x), '[]') from (
        select distinct on (b.bidder_id, a.host_id)
               jsonb_build_object('bidder_id', b.bidder_id, 'bidder', pb.display_name, 'host_id', a.host_id, 'host', ph.display_name,
                                  'auction_id', a.id, 'auction', a.title, 'ip', host(sb.ip)) as x
          from public.bids b
          join public.lots l on l.id = b.lot_id
          join public.auctions a on a.id = l.auction_id
          join auth.sessions sb on sb.user_id = b.bidder_id
          join auth.sessions sh on sh.user_id = a.host_id and sh.ip = sb.ip
          join public.profiles pb on pb.id = b.bidder_id
          join public.profiles ph on ph.id = a.host_id
         where b.bidder_id <> a.host_id and not b.is_auto
         limit 100) s),
    -- Pairs who repeatedly bid against each other on the same lots.
    'bidding_pairs', (select coalesce(jsonb_agg(x order by (x ->> 'shared_lots')::int desc), '[]') from (
        select jsonb_build_object('a', pa.display_name, 'a_id', p.a, 'b', pb.display_name, 'b_id', p.b, 'shared_lots', p.n) as x
          from (
            select b1.bidder_id as a, b2.bidder_id as b, count(distinct b1.lot_id) as n
              from public.bids b1
              join public.bids b2 on b2.lot_id = b1.lot_id and b2.bidder_id > b1.bidder_id
             where not b1.is_auto and not b2.is_auto
             group by 1, 2
            having count(distinct b1.lot_id) >= 3
             order by 3 desc limit 25
          ) p
          join public.profiles pa on pa.id = p.a
          join public.profiles pb on pb.id = p.b) s),
    -- Bidders who bid almost only on one host's lots and never win (classic shill bidding).
    'single_host_never_wins', (select coalesce(jsonb_agg(x order by (x ->> 'bids')::int desc), '[]') from (
        select jsonb_build_object('bidder_id', t.bidder_id, 'bidder', pb.display_name, 'host_id', t.host_id, 'host', ph.display_name,
                                  'bids', t.n, 'share_pct', round(t.n * 100.0 / t.total)) as x
          from (
            select b.bidder_id, a.host_id, count(*) as n,
                   sum(count(*)) over (partition by b.bidder_id) as total
              from public.bids b
              join public.lots l on l.id = b.lot_id
              join public.auctions a on a.id = l.auction_id
             where not b.is_auto
             group by 1, 2
          ) t
          join public.profiles pb on pb.id = t.bidder_id
          join public.profiles ph on ph.id = t.host_id
         where t.n >= 5 and t.n * 1.0 / t.total >= 0.8
           and not exists (select 1 from public.lots l where l.current_winner_id = t.bidder_id and l.status = 'sold')
         limit 25) s),
    -- Unusual bursts: more than 20 manual bids in one minute.
    'bid_bursts', (select coalesce(jsonb_agg(x order by (x ->> 'bids')::int desc), '[]') from (
        select jsonb_build_object('bidder_id', b.bidder_id, 'bidder', p.display_name, 'minute', date_trunc('minute', b.created_at), 'bids', count(*)) as x
          from public.bids b join public.profiles p on p.id = b.bidder_id
         where not b.is_auto and b.created_at > now() - interval '30 days'
         group by b.bidder_id, p.display_name, date_trunc('minute', b.created_at)
        having count(*) > 20
         limit 25) s),
    -- Brand-new accounts winning lots (check before handing over valuable items).
    'new_account_wins', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('winner_id', l.current_winner_id, 'winner', p.display_name, 'lot', l.title, 'price', l.current_bid,
                                  'auction_id', l.auction_id, 'account_age_hours', round(extract(epoch from (l.ends_at - u.created_at)) / 3600)) as x
          from public.lots l
          join auth.users u on u.id = l.current_winner_id
          join public.profiles p on p.id = l.current_winner_id
         where l.status = 'sold' and l.ends_at - u.created_at < interval '24 hours' and l.ends_at > now() - interval '30 days'
         order by l.current_bid desc
         limit 25) s)
  );
end;
$$;
revoke execute on function public.admin_fraud_signals() from public, anon;
grant execute on function public.admin_fraud_signals() to authenticated;

-- Hosts with at least one public, non-draft auction (for sitemap.xml).
create or replace function public.sitemap_hosts()
returns table (username text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.username
    from public.profiles p
    join public.auctions a on a.host_id = p.id
   where a.visibility = 'public' and a.status <> 'draft'
   limit 5000;
$$;
grant execute on function public.sitemap_hosts() to anon, authenticated;
