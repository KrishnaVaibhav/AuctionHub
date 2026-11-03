-- pgTAP tests for the bid engine, lifecycle and RLS. Run: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- Fixtures: host (…01), Alice (…0a), Bob (…0b)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'host@test.dev', '{"display_name":"Host"}'),
  ('00000000-0000-0000-0000-00000000000a', 'alice@test.dev', '{"display_name":"Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@test.dev', '{"display_name":"Bob"}');

select is((select count(*)::int from public.profiles where id in (
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b')),
  3, 'signup trigger creates profiles');

-- ---------------------------------------------------------------------------
-- Host creates an auction with two lots (RLS + column grants as authenticated)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into public.auctions (id, host_id, title, settings)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Test auction',
        '{"currency":"INR","anti_snipe_seconds":30,"lot_duration_minutes":10}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 0, 'Watch', 100),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 1, 'Lamp', 50);
insert into public.lot_reserves (lot_id, reserve_price) values ('20000000-0000-0000-0000-000000000002', 1000);

select throws_ok(
  $$insert into public.auctions (host_id, title) values ('00000000-0000-0000-0000-00000000000a', 'Spoofed')$$,
  '42501', null, 'cannot create an auction for someone else');

select lives_ok($$select public.start_auction('10000000-0000-0000-0000-000000000001')$$, 'host starts auction');
select is((select status::text from public.auctions where id = '10000000-0000-0000-0000-000000000001'), 'live', 'auction is live');
select is((select count(*)::int from public.lots where auction_id = '10000000-0000-0000-0000-000000000001' and status = 'open'), 2, 'lots open');
select throws_ok($$select public.place_bid('20000000-0000-0000-0000-000000000001', 500)$$,
  'P0001', 'Hosts cannot bid in their own auction', 'host cannot bid');

-- ---------------------------------------------------------------------------
-- Bidding with proxy bids
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is((public.place_bid('20000000-0000-0000-0000-000000000001', 100)) ->> 'status', 'leading', 'Alice opens at start price');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select throws_ok($$select public.place_bid('20000000-0000-0000-0000-000000000001', 105)$$,
  'P0001', 'Minimum bid is INR 110.00', 'bid below increment rejected');
select is((public.place_bid('20000000-0000-0000-0000-000000000001', 110, 500)) ->> 'current_bid', '110.00',
  'Bob leads at 110 with proxy max 500');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is((public.place_bid('20000000-0000-0000-0000-000000000001', 120, 300)) ->> 'status', 'outbid',
  'Alice max 300 loses to Bob proxy 500');
select is((select current_bid from public.lots where id = '20000000-0000-0000-0000-000000000001'), 310.00::numeric(12,2),
  'proxy defends at challenger max + increment');
select is((select current_winner_id from public.lots where id = '20000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-00000000000b'::uuid, 'Bob still leads');

select is((public.place_bid('20000000-0000-0000-0000-000000000001', 320, 600)) ->> 'current_bid', '510.00',
  'Alice max 600 beats Bob 500 at 500 + 10');
select is((public.place_bid('20000000-0000-0000-0000-000000000001', 510, 700)) ->> 'status', 'max_raised',
  'leader can raise own max');
select throws_ok($$select public.place_bid('20000000-0000-0000-0000-000000000001', 510, 650)$$,
  'P0001', 'You are already the highest bidder', 'leader cannot lower max');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((public.place_bid('20000000-0000-0000-0000-000000000001', 520, 700)) ->> 'status', 'outbid',
  'equal max: earlier bidder wins');
select is((select current_bid from public.lots where id = '20000000-0000-0000-0000-000000000001'), 700.00::numeric(12,2),
  'tie settles at the shared max');

-- Privacy + column grants
select is((select count(*)::int from public.proxy_bids), 1, 'bidder only sees own proxy bid');
select is((select count(*)::int from public.lot_reserves), 0, 'bidder cannot see reserves');
select throws_ok($$update public.lots set current_bid = 1 where id = '20000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'bidder cannot write lot prices');
select throws_ok($$insert into public.bids (lot_id, bidder_id, amount) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 9999)$$,
  '42501', null, 'bids only via place_bid');
select throws_ok($$select public.run_auction_jobs()$$, '42501', null, 'scheduler not callable by clients');

-- Reserve price
select is((public.place_bid('20000000-0000-0000-0000-000000000002', 50)) ->> 'status', 'leading', 'Bob bids on lamp');
select is((select reserve_met from public.lots where id = '20000000-0000-0000-0000-000000000002'), false, 'reserve not met');

-- Chat guard
select lives_ok($$insert into public.chat_messages (auction_id, user_id, body) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'hi')$$,
  'bidder can chat');
select throws_ok($$insert into public.chat_messages (auction_id, user_id, body) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'spam')$$,
  'P0001', 'Slow mode: wait 2 seconds between messages', 'slow mode enforced');
select throws_ok($$insert into public.chat_messages (auction_id, user_id, body) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'fake')$$,
  '42501', null, 'cannot post as someone else');

-- ---------------------------------------------------------------------------
-- Anti-sniping (as owner, move close time into the window)
-- ---------------------------------------------------------------------------
reset role;
update public.lots set ends_at = now() + interval '5 seconds' where id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select public.place_bid('20000000-0000-0000-0000-000000000002', 60);
select ok((select ends_at >= now() + interval '29 seconds' from public.lots where id = '20000000-0000-0000-0000-000000000002'),
  'late bid extends close by anti-snipe window');

-- ---------------------------------------------------------------------------
-- Closing
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.close_lot_now('20000000-0000-0000-0000-000000000001')$$, 'host closes watch');
select is((select status::text from public.lots where id = '20000000-0000-0000-0000-000000000001'), 'sold', 'watch sold');

reset role;
update public.lots set ends_at = now() - interval '1 second' where id = '20000000-0000-0000-0000-000000000002';
select public.run_auction_jobs();
select is((select status::text from public.lots where id = '20000000-0000-0000-0000-000000000002'), 'unsold', 'lamp unsold: reserve not met');
select is((select status::text from public.auctions where id = '10000000-0000-0000-0000-000000000001'), 'ended', 'auction ends when all lots close');

-- ---------------------------------------------------------------------------
-- Results (host) and activity (bidder)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.auction_results('10000000-0000-0000-0000-000000000001')), 2,
  'host sees all lot results');
select is((select winner_email from public.auction_results('10000000-0000-0000-0000-000000000001') where title = 'Watch'),
  null, 'winner email hidden until they opt in');
select is((select winner_email from public.auction_results('10000000-0000-0000-0000-000000000001') where title = 'Lamp'),
  null, 'no email for unsold lot');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select throws_ok($$select * from public.auction_results('10000000-0000-0000-0000-000000000001')$$,
  'P0001', 'Only the host can see results', 'bidder cannot see results');
select is((select count(*)::int from public.my_lots()), 2, 'bidder sees lots they bid on');
reset role;

select * from finish();
rollback;
