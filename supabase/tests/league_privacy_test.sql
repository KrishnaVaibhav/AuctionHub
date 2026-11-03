-- pgTAP tests: privacy defaults, deal chat, team league. Run: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'host2@test.dev', '{}'),
  ('00000000-0000-0000-0000-0000000000a2', 'teamone@test.dev', '{}'),
  ('00000000-0000-0000-0000-0000000000a3', 'teamtwo@test.dev', '{"display_name":"Two"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'outsider@test.dev', '{}');

-- Privacy: defaults leak nothing from email
select ok((select username not like 'host2%' and display_name not like 'host2%'
             from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'new profile does not use email');
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a3'), 'Two',
  'chosen display name kept');

-- ---------------------------------------------------------------------------
-- League setup
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into public.auctions (id, host_id, title, mode, starts_at, settings) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'League', 'league', now() + interval '1 day',
   '{"currency":"INR","increments":[[0,10]],"league":{"purse":1000,"squad_max":2,"squad_min":2,"min_base":100,"lot_seconds":30,"bid_seconds":15,"break_seconds":0}}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0, 'Player A', 100),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 1, 'Player B', 100),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 2, 'Player C', 100);

select throws_ok($$select public.join_league('30000000-0000-0000-0000-000000000001', 'Early', 'ERL')$$,
  'P0001', 'Teams can join once the host schedules the league', 'no joining a draft');
select lives_ok($$select public.schedule_auction('30000000-0000-0000-0000-000000000001')$$, 'host schedules league');
select throws_ok($$select public.join_league('30000000-0000-0000-0000-000000000001', 'Host XI', 'HST')$$,
  'P0001', 'The host is not playing in this league', 'host cannot join by default');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.join_league('30000000-0000-0000-0000-000000000001', 'Team One', 'ONE', '#ff0000')$$, 'team one joins');
select throws_ok($$select public.join_league('30000000-0000-0000-0000-000000000001', 'Again', 'AGN')$$,
  'P0001', 'You already have a team here, or that short name is taken', 'one team per user');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$select public.start_auction('30000000-0000-0000-0000-000000000001')$$,
  'P0001', 'At least 2 teams must join before the league starts', 'needs 2 teams');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select lives_ok($$select public.join_league('30000000-0000-0000-0000-000000000001', 'Team Two', 'TWO')$$, 'team two joins');
select is((select purse_left from public.league_teams where short_name = 'TWO' and auction_id = '30000000-0000-0000-0000-000000000001'), 1000.00::numeric(14,2), 'team starts with full purse');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.start_auction('30000000-0000-0000-0000-000000000001')$$, 'league starts');
select is((select count(*)::int from public.lots where auction_id = '30000000-0000-0000-0000-000000000001' and status = 'open'), 1,
  'only one player on the block');

-- ---------------------------------------------------------------------------
-- Team bidding
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.league_bid('40000000-0000-0000-0000-000000000001', 100)$$,
  'P0001', 'You need a team in this league to bid', 'outsider cannot bid');
select throws_ok($$select public.place_bid('40000000-0000-0000-0000-000000000001', 100)$$,
  'P0001', 'Use team bidding in league auctions', 'normal bidding disabled in league');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((public.league_bid('40000000-0000-0000-0000-000000000001', 100)) ->> 'status', 'leading', 'team one bids');
select throws_ok($$select public.league_bid('40000000-0000-0000-0000-000000000001', 110)$$,
  'P0001', 'Your team already has the highest bid', 'cannot outbid yourself');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.league_bid('40000000-0000-0000-0000-000000000001', 950)$$,
  'P0001', 'Not enough purse: INR 1,000.00 left (must keep INR 100.00 for remaining squad)', 'purse keeps room for min squad');
select is((public.league_bid('40000000-0000-0000-0000-000000000001', 300)) ->> 'status', 'leading', 'team two outbids');
select ok((select ends_at >= now() + interval '15 seconds' from public.lots where id = '40000000-0000-0000-0000-000000000001'),
  'timer at least bid_seconds after a bid');

-- Close by timer: league_tick (anyone) closes and opens the next player
reset role;
update public.lots set ends_at = now() - interval '1 second' where id = '40000000-0000-0000-0000-000000000001';
set local role anon;
select lives_ok($$select public.league_tick('30000000-0000-0000-0000-000000000001')$$, 'anyone can tick');
reset role;
select is((select status::text from public.lots where id = '40000000-0000-0000-0000-000000000001'), 'sold', 'player sold on timer');
select is((select purse_left from public.league_teams where short_name = 'TWO' and auction_id = '30000000-0000-0000-0000-000000000001'), 700.00::numeric(14,2), 'price deducted from purse');
select is((select status::text from public.lots where id = '40000000-0000-0000-0000-000000000002'), 'open', 'next player on the block');

-- Player B unsold, then requeued
update public.lots set ends_at = now() - interval '1 second' where id = '40000000-0000-0000-0000-000000000002';
select public.league_tick('30000000-0000-0000-0000-000000000001');
select is((select status::text from public.lots where id = '40000000-0000-0000-0000-000000000002'), 'unsold', 'no bids: unsold');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.set_lot_points('40000000-0000-0000-0000-000000000001', 42)$$, 'host sets points');
select lives_ok($$select public.close_lot_now('40000000-0000-0000-0000-000000000003')$$, 'host closes player C');
select is((public.league_requeue_unsold('30000000-0000-0000-0000-000000000001')), 2, 'unsold players requeued');
select is((select status::text from public.lots where id = '40000000-0000-0000-0000-000000000002'), 'open', 'requeued player back on block');

-- ---------------------------------------------------------------------------
-- Privacy: contact hidden until opt-in; deal chat only for host + winner
-- ---------------------------------------------------------------------------
select is((select winner_email from public.auction_results('30000000-0000-0000-0000-000000000001') where title = 'Player A'),
  null, 'winner email hidden by default');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}';
insert into public.contact_settings (user_id, share_contact, phone) values ('00000000-0000-0000-0000-0000000000a3', true, '+91 90000 00000');
select lives_ok($$insert into public.deal_messages (lot_id, sender_id, body) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'Hi host')$$,
  'winner can message host');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select winner_phone from public.auction_results('30000000-0000-0000-0000-000000000001') where title = 'Player A'),
  '+91 90000 00000', 'contact visible after opt-in');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$insert into public.deal_messages (lot_id, sender_id, body) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', 'spy')$$,
  '42501', null, 'outsider cannot use deal chat');

reset role;
select * from finish();
rollback;
