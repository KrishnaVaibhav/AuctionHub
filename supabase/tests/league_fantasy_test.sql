-- pgTAP tests: match stats, captains, team scores and the season table.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d001', 'fhost@test.dev'),
  ('00000000-0000-0000-0000-00000000d002', 'fowner1@test.dev'),
  ('00000000-0000-0000-0000-00000000d003', 'fowner2@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
insert into public.auctions (id, host_id, title, mode, starts_at, settings) values
  ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d001', 'Fantasy League', 'league', now() + interval '1 day',
   '{"league":{"purse":1000,"squad_max":5,"lot_seconds":30,"bid_seconds":15,"break_seconds":0,"scoring":{"runs":1,"wickets":25}}}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 0, 'Batter', 10),
  ('d1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 1, 'Bowler', 10);
select public.schedule_auction('d0000000-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
create temporary table _f1 as select public.join_league('d0000000-0000-0000-0000-000000000001', 'Red Rockets', 'RR') as id;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d003","role":"authenticated"}';
create temporary table _f2 as select public.join_league('d0000000-0000-0000-0000-000000000001', 'Blue Bolts', 'BB') as id;

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select is((select series_id from public.auctions where id = 'd0000000-0000-0000-0000-000000000001'),
  'd0000000-0000-0000-0000-000000000001'::uuid, 'a league starts its own series');
select throws_ok($$select public.league_record_match('d0000000-0000-0000-0000-000000000001', 'M1', null, '[{"lot_id":"d1000000-0000-0000-0000-000000000001","stats":{"runs":10}}]')$$,
  'P0001', 'Record matches after the draft has started', 'no matches before the draft');

-- Draft: team 1 buys both players.
select public.start_auction('d0000000-0000-0000-0000-000000000001');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
select public.league_bid('d1000000-0000-0000-0000-000000000001', 10);
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select public.close_lot_now('d1000000-0000-0000-0000-000000000001');
reset role;
update public.lots set opens_at = now() - interval '1 second' where id = 'd1000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
select public.league_bid('d1000000-0000-0000-0000-000000000002', 10);
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select public.close_lot_now('d1000000-0000-0000-0000-000000000002');

-- Captains
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d003","role":"authenticated"}';
select throws_ok($$select public.league_set_captain((select id from _f1), 'd1000000-0000-0000-0000-000000000001', null)$$,
  'P0001', 'Only the team owner can pick captains', 'only the owner picks captains');
select throws_ok($$select public.league_set_captain((select id from _f2), 'd1000000-0000-0000-0000-000000000001', null)$$,
  'P0001', 'Captains must be in your squad', 'captain must be in the squad');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
select lives_ok($$select public.league_set_captain((select id from _f1), 'd1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002')$$,
  'owner picks captain and vice');

-- Match: Batter 40 runs (captain x2 = 80), Bowler 2 wickets (vice x1.5 = 75).
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
create temporary table _m as select public.league_record_match('d0000000-0000-0000-0000-000000000001', 'Match 1', '2026-11-05',
  '[{"lot_id":"d1000000-0000-0000-0000-000000000001","stats":{"runs":40}},{"lot_id":"d1000000-0000-0000-0000-000000000002","stats":{"Wickets":2,"note":"great"}}]') as id;
select is((select points from public.league_player_stats where match_id = (select id from _m) and lot_id = 'd1000000-0000-0000-0000-000000000002'),
  50::numeric(10,2), 'stats scored by the league rules');
select is((select points from public.league_team_scores where match_id = (select id from _m) and team_id = (select id from _f1)),
  155::numeric(12,2), 'captain and vice multipliers applied');
select is((select points from public.league_team_scores where match_id = (select id from _m) and team_id = (select id from _f2)),
  0::numeric(12,2), 'team without players scores zero');
select is((select points from public.lots where id = 'd1000000-0000-0000-0000-000000000001'), 40::numeric(10,2), 'player total mirrored on the lot');

select is((public.league_season_table('d0000000-0000-0000-0000-000000000001') -> 'teams' -> 0 ->> 'name'), 'Red Rockets', 'season table ranks teams');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d002","role":"authenticated"}';
select throws_ok($$select public.league_delete_match((select id from _m))$$, 'P0001', 'Only the host can do this', 'owners cannot delete matches');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d001","role":"authenticated"}';
select public.league_delete_match((select id from _m));
select is((select points from public.lots where id = 'd1000000-0000-0000-0000-000000000001'), null, 'deleting a match clears its points');

select * from finish();
rollback;
