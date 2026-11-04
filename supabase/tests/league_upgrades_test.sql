-- pgTAP tests: retention, category caps, right to match, trades and next season.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ff01', 'lhost@test.dev'),
  ('00000000-0000-0000-0000-00000000ff02', 'lowner1@test.dev'),
  ('00000000-0000-0000-0000-00000000ff03', 'lowner2@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff01","role":"authenticated"}';
insert into public.auctions (id, host_id, title, mode, starts_at, settings) values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ff01', 'Gully League', 'league', now() + interval '1 day',
   '{"league":{"purse":1000,"squad_max":5,"retain_max":1,"rtm_cards":1,"rtm_seconds":20,"lot_seconds":30,"bid_seconds":15,"break_seconds":0,"category_max":{"Overseas":1}}}');
insert into public.lots (id, auction_id, position, title, start_price, custom_fields) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 0, 'Keeper', 10, '{}'),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 1, 'Pacer', 10, '{"Category":"Overseas"}'),
  ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 2, 'Spinner', 10, '{"Category":"Overseas"}'),
  ('f1000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', 3, 'Opener', 10, '{}');
select public.schedule_auction('f0000000-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff02","role":"authenticated"}';
create temporary table _t1 as select public.join_league('f0000000-0000-0000-0000-000000000001', 'Red Rockets', 'RR') as id;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff03","role":"authenticated"}';
create temporary table _t2 as select public.join_league('f0000000-0000-0000-0000-000000000001', 'Blue Bolts', 'BB') as id;

-- Retention
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff01","role":"authenticated"}';
select lives_ok($$select public.league_retain('f1000000-0000-0000-0000-000000000001', (select id from _t1), 100)$$, 'host retains a player');
select is((select purse_left from public.league_teams where id = (select id from _t1)), 900::numeric(14,2), 'retention price leaves the purse');
select throws_ok($$select public.league_retain('f1000000-0000-0000-0000-000000000004', (select id from _t1), 50)$$,
  'P0001', 'This team has used all its retentions', 'retain limit enforced');
update public.lots set rtm_team_id = (select id from _t1) where id = 'f1000000-0000-0000-0000-000000000004';
select is((select rtm_team_id from public.lots where id = 'f1000000-0000-0000-0000-000000000004'), (select id from _t1), 'host sets right to match');

select public.start_auction('f0000000-0000-0000-0000-000000000001');

-- Category cap: team 1 buys one Overseas player, then cannot bid on another.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff02","role":"authenticated"}';
select public.league_bid('f1000000-0000-0000-0000-000000000002', 10);
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff01","role":"authenticated"}';
select public.close_lot_now('f1000000-0000-0000-0000-000000000002');
reset role;
update public.lots set opens_at = now() - interval '1 second' where id = 'f1000000-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff02","role":"authenticated"}';
select throws_ok($$select public.league_bid('f1000000-0000-0000-0000-000000000003', 10)$$,
  'P0001', 'Your team already has 1 Overseas players', 'category cap enforced');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff03","role":"authenticated"}';
select public.league_bid('f1000000-0000-0000-0000-000000000003', 10);
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff01","role":"authenticated"}';
select public.close_lot_now('f1000000-0000-0000-0000-000000000003');

-- Right to match: team 2 wins the Opener, team 1 (previous owner) matches.
reset role;
update public.lots set opens_at = now() - interval '1 second' where id = 'f1000000-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff03","role":"authenticated"}';
select public.league_bid('f1000000-0000-0000-0000-000000000004', 40);
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff01","role":"authenticated"}';
select public.close_lot_now('f1000000-0000-0000-0000-000000000004');
select is((select status::text || '/' || rtm_offered::text from public.lots where id = 'f1000000-0000-0000-0000-000000000004'),
  'open/true', 'closing offers the right to match first');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff03","role":"authenticated"}';
select throws_ok($$select public.league_rtm('f1000000-0000-0000-0000-000000000004', true)$$,
  'P0001', 'Only the previous team can use the right to match', 'only the RTM team decides');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff02","role":"authenticated"}';
select lives_ok($$select public.league_rtm('f1000000-0000-0000-0000-000000000004', true)$$, 'previous team matches');
select is((select winner_team_id from public.lots where id = 'f1000000-0000-0000-0000-000000000004'), (select id from _t1), 'matched team gets the player');
select is((select purse_left from public.league_teams where id = (select id from _t1)), 850::numeric(14,2), 'match price paid by the matching team');
select is((select rtm_used from public.league_teams where id = (select id from _t1)), 1, 'RTM card used');
select is((select status::text from public.auctions where id = 'f0000000-0000-0000-0000-000000000001'), 'ended', 'league ends after the last player');

-- Trade: team 1 swaps the Pacer for team 2's Spinner plus 20 cash.
create temporary table _tr as select public.league_propose_trade('f0000000-0000-0000-0000-000000000001', (select id from _t2),
  array['f1000000-0000-0000-0000-000000000002']::uuid[], array['f1000000-0000-0000-0000-000000000003']::uuid[], 20, 'Swap?') as id;
select throws_ok($$select public.league_respond_trade((select id from _tr), true)$$,
  'P0001', 'Only the other team can answer this trade', 'proposer cannot accept own trade');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff03","role":"authenticated"}';
select lives_ok($$select public.league_respond_trade((select id from _tr), true)$$, 'other team accepts');
select is((select winner_team_id from public.lots where id = 'f1000000-0000-0000-0000-000000000003'), (select id from _t1), 'players swapped');

-- Next season keeps teams and gives previous owners the right to match.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ff01","role":"authenticated"}';
create temporary table _s2 as select public.league_next_season('f0000000-0000-0000-0000-000000000001') as id;
select is((select count(*)::int from public.league_teams where auction_id = (select id from _s2))
          || '/' || (select count(*)::int from public.lots where auction_id = (select id from _s2) and rtm_team_id is not null),
          '2/4', 'next season copies teams and sets RTM for every owned player');

reset role;
select * from finish();
rollback;
