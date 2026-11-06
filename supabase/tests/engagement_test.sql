-- pgTAP tests: host controls, guesses, badges, XP, parties, fixtures, deadline.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e101', 'ehost@test.dev'),
  ('00000000-0000-0000-0000-00000000e102', 'eguess1@test.dev'),
  ('00000000-0000-0000-0000-00000000e103', 'eguess2@test.dev'),
  ('00000000-0000-0000-0000-00000000e104', 'efriend@test.dev');
update public.profiles set username = 'e_inviter' where id = '00000000-0000-0000-0000-00000000e102';

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}';
insert into public.auctions (id, host_id, title, settings, tags) values
  ('e2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e101', 'Fun sale', '{"currency":"INR","lot_duration_minutes":30}', '{vintage}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('e2100000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 0, 'Radio', 100),
  ('e2100000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', 1, 'Camera', 100),
  ('e2100000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000001', 2, 'Spare', 100);
select public.start_auction('e2000000-0000-0000-0000-000000000001');

-- Host controls
select lives_ok($$select public.host_set_announcement('e2000000-0000-0000-0000-000000000001', '  Next lot in 2 min  ')$$, 'host posts an announcement');
select is((select announcement from public.auctions where id = 'e2000000-0000-0000-0000-000000000001'), 'Next lot in 2 min', 'announcement trimmed');
select is(public.host_set_features('e2000000-0000-0000-0000-000000000001', '{"reactions":false,"evil":true,"sounds":"yes"}'),
  '{"reactions":false}'::jsonb, 'only known boolean features are stored');
select lives_ok($$select public.set_lot_end('e2100000-0000-0000-0000-000000000002', now() + interval '2 hours')$$, 'host extends a lot');
select throws_ok($$select public.set_lot_end('e2100000-0000-0000-0000-000000000002', now())$$, 'P0001', null, 'cannot end in the past');
select throws_ok($$select public.make_prediction('e2100000-0000-0000-0000-000000000001', 'price', 500, null)$$,
  'P0001', 'Hosts can''t play in their own auction', 'host cannot guess');

-- Guesses
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e102","role":"authenticated"}';
select lives_ok($$select public.make_prediction('e2100000-0000-0000-0000-000000000001', 'price', 300, null)$$, 'guess placed');
select lives_ok($$select public.make_prediction('e2100000-0000-0000-0000-000000000001', 'price', 100, null)$$, 'guess can change before bidding');
select is((select xp from public.profiles where id = '00000000-0000-0000-0000-00000000e102'), 5, 'guessing earns XP once per lot, not per change');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e103","role":"authenticated"}';
select public.make_prediction('e2100000-0000-0000-0000-000000000001', 'price', 1000, null);
select is((select count(*)::int from public.predictions where lot_id = 'e2100000-0000-0000-0000-000000000001'), 1, 'others'' guesses are hidden while open');
select is((select guesses from public.prediction_counts('e2000000-0000-0000-0000-000000000001') where lot_id = 'e2100000-0000-0000-0000-000000000001'), 2, 'guess count is public');

-- Bidding locks guesses; e103 wins at the opening price.
select public.place_bid('e2100000-0000-0000-0000-000000000001', 100);
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e102","role":"authenticated"}';
select throws_ok($$select public.make_prediction('e2100000-0000-0000-0000-000000000001', 'price', 400, null)$$,
  'P0001', 'Guesses lock once bidding starts', 'guesses lock after the first bid');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}';
reset role;
insert into public.site_events (title, tag, starts_at, ends_at) values ('Vintage week', 'vintage', now() - interval '1 day', now() + interval '1 day');
update public.profiles set referred_by = '00000000-0000-0000-0000-00000000e102' where id = '00000000-0000-0000-0000-00000000e103';
set local role authenticated;
select public.close_lot_now('e2100000-0000-0000-0000-000000000001');

select is((select points from public.predictions where lot_id = 'e2100000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000e102'),
  100, 'exact guess scores 100');
select is((select points from public.predictions where lot_id = 'e2100000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000e103'),
  5, 'far guess scores 5');
select ok(exists (select 1 from public.user_badges where user_id = '00000000-0000-0000-0000-00000000e102' and badge = 'bullseye'), 'bullseye badge');
select ok(exists (select 1 from public.user_badges where user_id = '00000000-0000-0000-0000-00000000e103' and badge = 'first_win'), 'first win badge');
select ok(exists (select 1 from public.user_badges where user_id = '00000000-0000-0000-0000-00000000e103' and badge = 'bargain'), 'bargain badge');
select ok(exists (select 1 from public.user_badges where user_id = '00000000-0000-0000-0000-00000000e102' and badge = 'recruiter'), 'referrer rewarded');
select ok(exists (select 1 from public.user_badges where user_id = '00000000-0000-0000-0000-00000000e103' and badge like 'event:%'), 'event badge for a tagged win');
select is((select user_id from public.prediction_leaderboard(7, null) limit 1), '00000000-0000-0000-0000-00000000e102'::uuid, 'leaderboard ranks the best guesser');

-- Reopen an unsold lot
select public.close_lot_now('e2100000-0000-0000-0000-000000000002');
select lives_ok($$select public.reopen_lot('e2100000-0000-0000-0000-000000000002', 5)$$, 'host reopens an unsold lot');
select is((select status::text from public.lots where id = 'e2100000-0000-0000-0000-000000000002'), 'open', 'lot is open again');

-- Cosmetics are level-gated
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e104","role":"authenticated"}';
select throws_ok($$select public.set_cosmetics('amber', null)$$, 'P0001', 'Chat colours unlock at level 3', 'colours locked at level 1');
select is(public.claim_referral('e_inviter'), true, 'new user claims a referral');

-- Watch party
create temporary table _wp as select public.create_watch_party('e2000000-0000-0000-0000-000000000001', 'Couch crew') as j;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e103","role":"authenticated"}';
select is((select count(*)::int from public.watch_parties), 0, 'non-members cannot see the party');
select public.join_watch_party((select j ->> 'code' from _wp));
insert into public.watch_party_messages (party_id, user_id, body) values (((select j ->> 'id' from _wp))::uuid, '00000000-0000-0000-0000-00000000e103', 'hi all');
select is((select count(*)::int from public.watch_party_messages), 1, 'members chat in the party');

-- Trade deadline blocks new trades
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}';
insert into public.auctions (id, host_id, title, mode, starts_at, settings) values
  ('e3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e101', 'Deadline League', 'league', now() + interval '1 day',
   '{"league":{"purse":1000,"trades":true,"trade_deadline":"2020-01-01T00:00:00Z"}}');
insert into public.lots (auction_id, position, title, start_price) values ('e3000000-0000-0000-0000-000000000001', 0, 'Player', 10);
select public.schedule_auction('e3000000-0000-0000-0000-000000000001');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e102","role":"authenticated"}';
create temporary table _ta as select public.join_league('e3000000-0000-0000-0000-000000000001', 'Alpha', 'AL') as id;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e103","role":"authenticated"}';
create temporary table _tb as select public.join_league('e3000000-0000-0000-0000-000000000001', 'Beta', 'BE') as id;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}';
select is(public.league_generate_fixtures('e3000000-0000-0000-0000-000000000001', '2026-12-01', 7), 1, 'two teams play one round');
reset role;
select throws_ok($$insert into public.league_trades (auction_id, from_team, to_team, cash) values ('e3000000-0000-0000-0000-000000000001', (select id from _ta), (select id from _tb), 10)$$,
  'P0001', 'The trade deadline has passed', 'trade deadline enforced');

select * from finish();
rollback;
