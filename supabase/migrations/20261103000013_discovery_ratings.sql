-- Discovery (categories, tags) and buyer/seller ratings.

alter table public.auctions
  add column category text check (category in ('art', 'collectibles', 'coins', 'electronics', 'fashion', 'jewellery',
                                               'vehicles', 'home', 'sports', 'books', 'charity', 'other')),
  add column tags text[] not null default '{}' check (cardinality(tags) <= 8);
create index auctions_category_idx on public.auctions (category, status) where visibility = 'public';
grant insert (category, tags), update (category, tags) on public.auctions to authenticated;

-- One rating per party per sold lot: winner rates host ("seller"), host rates winner ("buyer").
create table public.ratings (
  id          bigint generated always as identity primary key,
  lot_id      uuid not null references public.lots (id) on delete cascade,
  rater_id    uuid not null references public.profiles (id) on delete cascade,
  ratee_id    uuid not null references public.profiles (id) on delete cascade,
  role        text not null check (role in ('seller', 'buyer')),   -- role of the person being rated
  stars       int not null check (stars between 1 and 5),
  comment     text check (comment is null or char_length(comment) <= 500),
  created_at  timestamptz not null default now(),
  unique (lot_id, rater_id)
);
create index ratings_ratee_idx on public.ratings (ratee_id, created_at desc);

alter table public.ratings enable row level security;
revoke all on public.ratings from anon, authenticated;
grant select on public.ratings to anon, authenticated;
create policy "ratings public" on public.ratings for select using (true);

create or replace function public.rate_trade(p_lot_id uuid, p_stars int, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  l    public.lots;
  host uuid;
begin
  select * into l from public.lots where id = p_lot_id;
  select host_id into host from public.auctions where id = l.auction_id;
  if l.id is null or l.status <> 'sold' or l.current_winner_id is null then
    raise exception 'You can only rate completed sales' using errcode = 'P0001';
  end if;
  if uid = l.current_winner_id then
    insert into public.ratings (lot_id, rater_id, ratee_id, role, stars, comment)
    values (p_lot_id, uid, host, 'seller', p_stars, nullif(btrim(p_comment), ''))
    on conflict (lot_id, rater_id) do update set stars = excluded.stars, comment = excluded.comment, created_at = now();
  elsif uid = host then
    insert into public.ratings (lot_id, rater_id, ratee_id, role, stars, comment)
    values (p_lot_id, uid, l.current_winner_id, 'buyer', p_stars, nullif(btrim(p_comment), ''))
    on conflict (lot_id, rater_id) do update set stars = excluded.stars, comment = excluded.comment, created_at = now();
  else
    raise exception 'Only the buyer and seller can rate this sale' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.rate_trade(uuid, int, text) from public, anon;
grant execute on function public.rate_trade(uuid, int, text) to authenticated;

-- Public profile card: stats, rating, followers. Never exposes private data.
create or replace function public.public_profile(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar_url', p.avatar_url,
    'joined', p.created_at,
    'followers', (select count(*) from public.follows f where f.host_id = p.id),
    'following', (select count(*) from public.follows f where f.follower_id = p.id),
    'auctions_hosted', (select count(*) from public.auctions a where a.host_id = p.id and a.visibility = 'public' and a.status <> 'draft'),
    'lots_sold', (select count(*) from public.lots l join public.auctions a on a.id = l.auction_id
                   where a.host_id = p.id and a.visibility = 'public' and l.status = 'sold'),
    'seller_rating', (select jsonb_build_object('avg', round(avg(stars)::numeric, 2), 'count', count(*)) from public.ratings r where r.ratee_id = p.id and r.role = 'seller'),
    'buyer_rating', (select jsonb_build_object('avg', round(avg(stars)::numeric, 2), 'count', count(*)) from public.ratings r where r.ratee_id = p.id and r.role = 'buyer')
  )
  from public.profiles p
  where lower(p.username) = lower(p_username);
$$;
grant execute on function public.public_profile(text) to anon, authenticated;
