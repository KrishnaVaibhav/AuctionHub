-- pgTAP tests: duplicate auction and analytics permissions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000cc01', 'thost@test.dev'),
  ('00000000-0000-0000-0000-00000000cc02', 'tbidder@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000cc01","role":"authenticated"}';
insert into public.auctions (id, host_id, title, category) values
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cc01', 'Original', 'art');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 0, 'Painting', 100),
  ('c1000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 1, 'Sketch', 50);
insert into public.lot_reserves (lot_id, reserve_price) values ('c1000000-0000-0000-0000-000000000001', 500);

create temporary table _dup as select public.duplicate_auction('c0000000-0000-0000-0000-000000000001') as id;
select is((select title from public.auctions where id = (select id from _dup)), 'Original (copy)', 'copy is created');
select is((select status::text from public.auctions where id = (select id from _dup)), 'draft', 'copy is a draft');
select is((select count(*)::int from public.lots where auction_id = (select id from _dup)), 2, 'lots copied');
select is((select count(*)::int from public.lot_reserves r join public.lots l on l.id = r.lot_id where l.auction_id = (select id from _dup)), 1, 'reserves copied');

select public.start_auction('c0000000-0000-0000-0000-000000000001');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000cc02","role":"authenticated"}';
select public.place_bid('c1000000-0000-0000-0000-000000000002', 50);
select throws_ok($$select public.duplicate_auction('c0000000-0000-0000-0000-000000000001')$$, 'P0001', 'Only the host can do this', 'only host can duplicate');
select throws_ok($$select public.auction_analytics('c0000000-0000-0000-0000-000000000001')$$, 'P0001', 'Only the host can see analytics', 'only host sees analytics');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000cc01","role":"authenticated"}';
select is((public.auction_analytics('c0000000-0000-0000-0000-000000000001') ->> 'unique_bidders')::int, 1, 'analytics counts bidders');
select is(jsonb_array_length(public.auction_analytics('c0000000-0000-0000-0000-000000000001') -> 'per_lot'), 2, 'analytics per lot');

reset role;
select * from finish();
rollback;
