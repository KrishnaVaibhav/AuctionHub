-- pgTAP tests: Dutch, sealed-bid and offer lots.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ee01', 'shost3@test.dev'),
  ('00000000-0000-0000-0000-00000000ee02', 'sbuyer1@test.dev'),
  ('00000000-0000-0000-0000-00000000ee03', 'sbuyer2@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee01","role":"authenticated"}';
insert into public.auctions (id, host_id, title) values
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ee01', 'Mixed sale');

select throws_ok($$insert into public.lots (auction_id, title, start_price, sale_type, sale_settings)
  values ('e0000000-0000-0000-0000-000000000001', 'Bad dutch', 100, 'dutch', '{"step":10,"floor":200,"interval_s":30}')$$,
  'P0001', null, 'dutch floor must be below start');

insert into public.lots (id, auction_id, position, title, start_price, sale_type, sale_settings) values
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 0, 'Dutch vase', 1000, 'dutch', '{"step":100,"floor":400,"interval_s":60}'),
  ('e1000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 1, 'Sealed coin', 500, 'sealed', '{}'),
  ('e1000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 2, 'Offer chair', 300, 'offer', '{}'),
  ('e1000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', 3, 'Offer lamp', 100, 'offer', '{}');
select public.start_auction('e0000000-0000-0000-0000-000000000001');

select throws_ok($$update public.lots set sale_type = 'english' where id = 'e1000000-0000-0000-0000-000000000001'$$,
  'P0001', 'Sale type can only change before the lot opens', 'sale type locked once open');

-- Dutch
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee02","role":"authenticated"}';
select throws_ok($$select public.place_bid('e1000000-0000-0000-0000-000000000001', 1000)$$,
  'P0001', 'This is a Dutch lot. Accept the current price to buy it.', 'place_bid refused on dutch');
reset role;
update public.lots set opens_at = now() - interval '150 seconds' where id = 'e1000000-0000-0000-0000-000000000001';
set local role authenticated;
select is((public.dutch_accept('e1000000-0000-0000-0000-000000000001') ->> 'current_bid')::numeric, 800::numeric, 'price dropped two steps');
select is((select status::text from public.lots where id = 'e1000000-0000-0000-0000-000000000001'), 'sold', 'dutch lot sold on accept');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee03","role":"authenticated"}';
select throws_ok($$select public.dutch_accept('e1000000-0000-0000-0000-000000000001')$$, 'P0001', 'Bidding is closed for this lot', 'second accept fails');

-- Sealed
select throws_ok($$select public.place_sealed_bid('e1000000-0000-0000-0000-000000000002', 400)$$, 'P0001', null, 'sealed bid below start refused');
select lives_ok($$select public.place_sealed_bid('e1000000-0000-0000-0000-000000000002', 700)$$, 'buyer 2 seals 700');
select throws_ok($$select public.place_sealed_bid('e1000000-0000-0000-0000-000000000002', 650)$$, 'P0001', 'Sealed bids can only be raised', 'sealed bids raise-only');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee02","role":"authenticated"}';
select lives_ok($$select public.place_sealed_bid('e1000000-0000-0000-0000-000000000002', 900)$$, 'buyer 1 seals 900');
select is((select count(*)::int from public.sealed_bids where lot_id = 'e1000000-0000-0000-0000-000000000002'), 1, 'only own sealed bid visible');
select is((select current_bid from public.lots where id = 'e1000000-0000-0000-0000-000000000002'), null, 'price hidden while open');
select is((select bid_count from public.lots where id = 'e1000000-0000-0000-0000-000000000002'), 2, 'bidder count public');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee01","role":"authenticated"}';
select is((select count(*)::int from public.sealed_bids where lot_id = 'e1000000-0000-0000-0000-000000000002'), 0, 'host cannot see sealed bids');
select public.close_lot_now('e1000000-0000-0000-0000-000000000002');
select is((select current_winner_id from public.lots where id = 'e1000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-00000000ee02'::uuid, 'highest sealed bid wins');
select is((select count(*)::int from public.bids where lot_id = 'e1000000-0000-0000-0000-000000000002'), 2, 'sealed bids revealed in bid log');

-- Offers
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee03","role":"authenticated"}';
select throws_ok($$select public.place_bid('e1000000-0000-0000-0000-000000000003', 300)$$, 'P0001', 'This lot takes offers', 'place_bid refused on offer lot');
create temporary table _o1 as select public.make_offer('e1000000-0000-0000-0000-000000000003', 350, 'cash today') as id;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee02","role":"authenticated"}';
create temporary table _o2 as select public.make_offer('e1000000-0000-0000-0000-000000000003', 400) as id;
select is((select count(*)::int from public.lot_offers where lot_id = 'e1000000-0000-0000-0000-000000000003'), 1, 'bidders see only their offers');
select throws_ok($$select public.respond_offer((select id from _o1), true)$$, 'P0001', 'Only the host can do this', 'only host responds');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee01","role":"authenticated"}';
select is((select count(*)::int from public.lot_offers where lot_id = 'e1000000-0000-0000-0000-000000000003'), 2, 'host sees all offers');
select lives_ok($$select public.respond_offer((select id from _o1), true)$$, 'host accepts the lower offer');
select is((select current_bid from public.lots where id = 'e1000000-0000-0000-0000-000000000003'), 350::numeric(12,2), 'sold at accepted offer');
select is((select status from public.lot_offers where id = (select id from _o2)), 'declined', 'other offers declined');

-- Offer lot closes unsold when nothing is accepted; pending offers expire.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee02","role":"authenticated"}';
select public.make_offer('e1000000-0000-0000-0000-000000000004', 150);
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ee01","role":"authenticated"}';
select public.close_lot_now('e1000000-0000-0000-0000-000000000004');
select is((select status::text from public.lots where id = 'e1000000-0000-0000-0000-000000000004') || '/' ||
          (select status from public.lot_offers where lot_id = 'e1000000-0000-0000-0000-000000000004'),
          'unsold/expired', 'unanswered offers expire at close');

reset role;
select * from finish();
rollback;
