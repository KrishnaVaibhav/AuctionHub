-- Price hints from past sales, and host webhooks (delivered by Supabase's built-in pg_net).

-- ---------------------------------------------------------------------------
-- Price hints: what similar lots sold for in public auctions over the last year.
-- ---------------------------------------------------------------------------
create or replace function public.price_hint(p_category text, p_currency text default 'INR', p_title text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with sold as (
    select l.current_bid as price,
           (p_title is not null and length(btrim(p_title)) >= 3 and l.title ilike '%' || btrim(p_title) || '%') as similar
      from public.lots l
      join public.auctions a on a.id = l.auction_id
     where l.status = 'sold' and l.current_bid > 0
       and a.visibility = 'public' and a.mode = 'standard'
       and a.category = p_category
       and coalesce(a.settings ->> 'currency', 'INR') = coalesce(p_currency, 'INR')
       and l.ends_at > now() - interval '365 days'
  ), pick as (
    -- Prefer title matches when there are enough of them.
    select price from sold
     where similar or (select count(*) from sold where similar) < 3
  )
  select case when count(*) < 3 then null else jsonb_build_object(
           'count', count(*),
           'low', percentile_cont(0.25) within group (order by price),
           'median', percentile_cont(0.5) within group (order by price),
           'high', percentile_cont(0.75) within group (order by price),
           'similar', (select count(*) from sold where similar) >= 3)
         end
    from pick;
$$;
grant execute on function public.price_hint(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Webhooks
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create table public.host_webhooks (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references public.profiles (id) on delete cascade,
  url           text not null check (url ~ '^https://[^\s/]+' and char_length(url) <= 500),
  secret        text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  events        text[] not null default array['auction.live', 'auction.ended', 'lot.sold', 'lot.unsold']
                check (events <@ array['auction.live', 'auction.ended', 'lot.sold', 'lot.unsold']),
  active        boolean not null default true,
  last_sent_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index host_webhooks_host_idx on public.host_webhooks (host_id) where active;
alter table public.host_webhooks enable row level security;
revoke all on public.host_webhooks from anon, authenticated;
grant select, delete on public.host_webhooks to authenticated;
grant insert (url, events), update (url, events, active) on public.host_webhooks to authenticated;
create policy "own webhooks" on public.host_webhooks for all to authenticated
  using (host_id = (select auth.uid())) with check (host_id = (select auth.uid()));

create or replace function public.guard_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  host text := lower(substring(new.url from '^https://([^/:?#]+)'));
begin
  if tg_op = 'INSERT' then
    new.host_id := auth.uid();
    if (select count(*) from public.host_webhooks w where w.host_id = new.host_id) >= 5 then
      raise exception 'You can have up to 5 webhooks' using errcode = 'P0001';
    end if;
  end if;
  -- No internal or private network targets.
  if host is null
     or host in ('localhost', '0.0.0.0', '[::1]', 'metadata.google.internal')
     or host ~ '\.(local|internal|localhost|test)$'
     or host ~ '^(127|10|0)\.'
     or host ~ '^169\.254\.'
     or host ~ '^192\.168\.'
     or host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.'
     or host ~ '^\[' then
    raise exception 'Webhook URL must be a public https address' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger host_webhooks_guard before insert or update of url on public.host_webhooks
  for each row execute function public.guard_webhook();
revoke execute on function public.guard_webhook() from public, anon, authenticated;

-- Signed delivery: X-AuctionHub-Signature = hex HMAC-SHA256 of the body with the webhook secret.
create or replace function public._send_webhooks(p_host uuid, p_event text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w    public.host_webhooks;
  body text;
begin
  for w in select * from public.host_webhooks where host_id = p_host and active and p_event = any (events) loop
    body := jsonb_build_object('event', p_event, 'sent_at', now(), 'data', p_data)::text;
    perform net.http_post(
      url := w.url,
      body := body::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'User-Agent', 'AuctionHub-Webhooks/1',
        'X-AuctionHub-Event', p_event,
        'X-AuctionHub-Signature', encode(extensions.hmac(body, w.secret, 'sha256'), 'hex')),
      timeout_milliseconds := 5000);
    update public.host_webhooks set last_sent_at = now() where id = w.id;
  end loop;
end;
$$;
revoke execute on function public._send_webhooks(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.webhook_lot_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions;
begin
  if new.status is not distinct from old.status or new.status not in ('sold', 'unsold') then
    return null;
  end if;
  select * into a from public.auctions where id = new.auction_id;
  if not exists (select 1 from public.host_webhooks w where w.host_id = a.host_id and w.active) then
    return null;
  end if;
  perform public._send_webhooks(a.host_id, 'lot.' || new.status::text, jsonb_build_object(
    'auction_id', a.id, 'auction_title', a.title, 'lot_id', new.id, 'lot_title', new.title,
    'price', new.current_bid, 'currency', coalesce(a.settings ->> 'currency', 'INR'),
    'winner_id', case when new.status = 'sold' then new.current_winner_id end,
    'sale_type', new.sale_type));
  return null;
end;
$$;
create trigger lots_webhooks after update of status on public.lots
  for each row execute function public.webhook_lot_change();
revoke execute on function public.webhook_lot_change() from public, anon, authenticated;

create or replace function public.webhook_auction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status or new.status not in ('live', 'ended') then
    return null;
  end if;
  if not exists (select 1 from public.host_webhooks w where w.host_id = new.host_id and w.active) then
    return null;
  end if;
  perform public._send_webhooks(new.host_id, 'auction.' || new.status::text, jsonb_build_object(
    'auction_id', new.id, 'title', new.title, 'status', new.status,
    'lots_sold', (select count(*) from public.lots l where l.auction_id = new.id and l.status = 'sold'),
    'total', (select coalesce(sum(l.current_bid), 0) from public.lots l where l.auction_id = new.id and l.status = 'sold')));
  return null;
end;
$$;
create trigger auctions_webhooks after update of status on public.auctions
  for each row execute function public.webhook_auction_change();
revoke execute on function public.webhook_auction_change() from public, anon, authenticated;

-- Send a test event to one webhook.
create or replace function public.test_webhook(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.host_webhooks;
  body text;
begin
  select * into w from public.host_webhooks where id = p_id and host_id = auth.uid();
  if w.id is null then
    raise exception 'Webhook not found' using errcode = 'P0001';
  end if;
  body := jsonb_build_object('event', 'ping', 'sent_at', now(), 'data', jsonb_build_object('message', 'Hello from AuctionHub'))::text;
  perform net.http_post(
    url := w.url,
    body := body::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'User-Agent', 'AuctionHub-Webhooks/1',
      'X-AuctionHub-Event', 'ping', 'X-AuctionHub-Signature', encode(extensions.hmac(body, w.secret, 'sha256'), 'hex')),
    timeout_milliseconds := 5000);
  update public.host_webhooks set last_sent_at = now() where id = w.id;
end;
$$;
revoke execute on function public.test_webhook(uuid) from public, anon;
grant execute on function public.test_webhook(uuid) to authenticated;
