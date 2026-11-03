-- Privacy: personal contact info is private by default and shared only on opt-in.
-- Adds a private host<->winner chat per sold lot so deals can be arranged without
-- exposing contact details. New profiles no longer derive names from email.

-- ---------------------------------------------------------------------------
-- Private contact settings (never publicly readable)
-- ---------------------------------------------------------------------------
create table public.contact_settings (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  share_contact  boolean not null default false,
  phone          text check (phone is null or char_length(phone) <= 30),
  note           text check (note is null or char_length(note) <= 200),
  updated_at     timestamptz not null default now()
);

alter table public.contact_settings enable row level security;
create policy "contact own" on public.contact_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.contact_settings from anon;
grant select, insert, update, delete on public.contact_settings to authenticated;

create trigger contact_settings_touch before update on public.contact_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- New users: anonymous-looking defaults, nothing taken from email or Google name
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hex text := md5(new.id::text);
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    'user_' || substr(hex, 1, 12),
    coalesce(nullif(btrim(left(new.raw_user_meta_data ->> 'display_name', 50)), ''), 'Bidder ' || upper(substr(hex, 1, 4)))
  );
  return new;
end;
$$;

-- Existing users still on the old email-derived defaults get anonymized.
with old as (
  select p.id,
         replace(p.id::text, '-', '') as hex,
         md5(p.id::text) as h,
         coalesce(nullif(lower(regexp_replace(split_part(coalesce(u.email, 'user'), '@', 1), '[^a-zA-Z0-9_]', '', 'g')), ''), 'user') as raw_base
    from public.profiles p
    join auth.users u on u.id = p.id
), base as (
  select id, hex, h, case when char_length(raw_base) < 3 then 'user' else raw_base end as b from old
)
update public.profiles p
   set username = case when p.username = left(base.b, 17) || '_' || substr(base.hex, 1, 6)
                       then 'user_' || substr(base.h, 1, 12) else p.username end,
       display_name = case when p.display_name = left(base.b, 50)
                           then 'Bidder ' || upper(substr(base.h, 1, 4)) else p.display_name end
  from base
 where base.id = p.id;

-- ---------------------------------------------------------------------------
-- Results / activity now expose contact only when that person opted in
-- ---------------------------------------------------------------------------
drop function if exists public.auction_results(uuid);
create function public.auction_results(p_auction_id uuid)
returns table (
  lot_id           uuid,
  "position"       int,
  title            text,
  status           public.lot_status,
  final_price      numeric,
  bid_count        int,
  reserve_met      boolean,
  winner_id        uuid,
  winner_name      text,
  winner_username  text,
  winner_email     text,
  winner_phone     text,
  winner_note      text,
  closed_at        timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_auction_host(p_auction_id) then
    raise exception 'Only the host can see results' using errcode = 'P0001';
  end if;
  return query
    select l.id, l.position, l.title, l.status, l.current_bid, l.bid_count, l.reserve_met,
           l.current_winner_id, p.display_name, p.username,
           case when l.status = 'sold' and cs.share_contact then u.email::text end,
           case when l.status = 'sold' and cs.share_contact then cs.phone end,
           case when l.status = 'sold' and cs.share_contact then cs.note end,
           case when l.status in ('sold', 'unsold', 'withdrawn') then l.ends_at end
      from public.lots l
      left join public.profiles p on p.id = l.current_winner_id
      left join auth.users u on u.id = l.current_winner_id
      left join public.contact_settings cs on cs.user_id = l.current_winner_id
     where l.auction_id = p_auction_id
     order by l.position, l.created_at;
end;
$$;

drop function if exists public.my_lots();
create function public.my_lots()
returns table (
  lot_id          uuid,
  auction_id      uuid,
  auction_title   text,
  auction_status  public.auction_status,
  currency        text,
  host_id         uuid,
  title           text,
  status          public.lot_status,
  current_bid     numeric,
  my_top_bid      numeric,
  my_max          numeric,
  is_leader       boolean,
  ends_at         timestamptz,
  last_bid_at     timestamptz,
  host_email      text,
  host_phone      text,
  host_note       text
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select b.lot_id, max(b.amount) as top, max(b.created_at) as last_at
      from public.bids b
     where b.bidder_id = (select auth.uid())
     group by b.lot_id
  )
  select l.id, a.id, a.title, a.status, coalesce(a.settings ->> 'currency', 'INR'), a.host_id,
         l.title, l.status, l.current_bid, m.top, pb.max_amount,
         l.current_winner_id = (select auth.uid()), l.ends_at, m.last_at,
         case when won.ok and hcs.share_contact then hu.email::text end,
         case when won.ok and hcs.share_contact then hcs.phone end,
         case when won.ok and hcs.share_contact then hcs.note end
    from mine m
    join public.lots l on l.id = m.lot_id
    join public.auctions a on a.id = l.auction_id
    cross join lateral (select l.status = 'sold' and l.current_winner_id = (select auth.uid()) as ok) won
    left join public.proxy_bids pb on pb.lot_id = l.id and pb.bidder_id = (select auth.uid())
    left join public.contact_settings hcs on hcs.user_id = a.host_id
    left join auth.users hu on hu.id = a.host_id
   order by m.last_at desc
   limit 500;
$$;

revoke execute on function public.auction_results(uuid), public.my_lots() from public, anon;
grant execute on function public.auction_results(uuid), public.my_lots() to authenticated;

-- ---------------------------------------------------------------------------
-- Deal chat: private messages between host and winner of a sold lot
-- ---------------------------------------------------------------------------
create table public.deal_messages (
  id          bigint generated always as identity primary key,
  lot_id      uuid not null references public.lots (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index deal_messages_lot_idx on public.deal_messages (lot_id, id);

create or replace function public.is_deal_party(p_lot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.lots l
      join public.auctions a on a.id = l.auction_id
     where l.id = p_lot_id
       and l.status = 'sold'
       and (select auth.uid()) in (l.current_winner_id, a.host_id)
  );
$$;

alter table public.deal_messages enable row level security;
create policy "deal parties read" on public.deal_messages for select to authenticated
  using (public.is_deal_party(lot_id));
create policy "deal parties send" on public.deal_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.is_deal_party(lot_id));

revoke all on public.deal_messages from anon, authenticated;
grant select on public.deal_messages to authenticated;
grant insert (lot_id, sender_id, body) on public.deal_messages to authenticated;

alter publication supabase_realtime add table public.deal_messages;
