-- pgTAP tests: categories, ratings rules, public profile.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000bb01', 'rhost@test.dev'),
  ('00000000-0000-0000-0000-00000000bb02', 'rbuyer@test.dev'),
  ('00000000-0000-0000-0000-00000000bb03', 'rother@test.dev');
update public.profiles set username = 'rating_host' where id = '00000000-0000-0000-0000-00000000bb01';

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000bb01","role":"authenticated"}';
select lives_ok($$insert into public.auctions (id, host_id, title, category, tags) values ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000bb01', 'Coins', 'coins', '{silver,india}')$$, 'host sets category and tags');
select throws_ok($$insert into public.auctions (host_id, title, category) values ('00000000-0000-0000-0000-00000000bb01', 'Bad', 'weapons')$$, '23514', null, 'unknown category rejected');
insert into public.lots (id, auction_id, title, start_price) values ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Rupee', 10);
select public.start_auction('b0000000-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000bb02","role":"authenticated"}';
select throws_ok($$select public.rate_trade('b1000000-0000-0000-0000-000000000001', 5)$$, 'P0001', 'You can only rate completed sales', 'no rating before sale');
select public.place_bid('b1000000-0000-0000-0000-000000000001', 10);

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000bb01","role":"authenticated"}';
select public.close_lot_now('b1000000-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000bb02","role":"authenticated"}';
select lives_ok($$select public.rate_trade('b1000000-0000-0000-0000-000000000001', 4, 'Fast delivery')$$, 'buyer rates seller');
select lives_ok($$select public.rate_trade('b1000000-0000-0000-0000-000000000001', 5, 'Changed my mind: great')$$, 'buyer can update rating');
select throws_ok($$insert into public.ratings (lot_id, rater_id, ratee_id, role, stars) values ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000bb01', 'seller', 1)$$, '42501', null, 'ratings only via rate_trade');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000bb03","role":"authenticated"}';
select throws_ok($$select public.rate_trade('b1000000-0000-0000-0000-000000000001', 1)$$, 'P0001', 'Only the buyer and seller can rate this sale', 'outsider cannot rate');

set local role anon;
select is((public.public_profile('RATING_HOST') -> 'seller_rating' ->> 'avg')::numeric, 5.00, 'profile shows seller rating');
select is((public.public_profile('rating_host') ->> 'lots_sold')::int, 1, 'profile shows lots sold');

reset role;
select * from finish();
rollback;
