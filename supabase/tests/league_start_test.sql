-- pgTAP tests: the host starts a league whenever they like; teams can join late.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c101', 'lhost@test.dev'),
  ('00000000-0000-0000-0000-00000000c102', 'lteam@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000c101","role":"authenticated"}';
insert into public.auctions (id, host_id, title, mode, settings) values
  ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c101', 'Solo league', 'league',
   '{"currency":"INR","increments":[[0,10]],"league":{"purse":1000,"squad_max":2,"min_base":100,"lot_seconds":30,"bid_seconds":15,"break_seconds":0}}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('c2100000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 0, 'Player A', 100);

select lives_ok($$select public.start_auction('c2000000-0000-0000-0000-000000000001')$$, 'host starts a league with no teams');
select is((select status::text from public.auctions where id = 'c2000000-0000-0000-0000-000000000001'), 'live', 'league is live');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000c102","role":"authenticated"}';
select lives_ok($$select public.join_league('c2000000-0000-0000-0000-000000000001', 'Late Larks', 'LL')$$, 'a team joins after the start');
select is((select purse_left from public.league_teams where auction_id = 'c2000000-0000-0000-0000-000000000001'), 1000.00::numeric(14,2), 'late team gets the full purse');

reset role;
update public.auctions set status = 'ended' where id = 'c2000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select public.join_league('c2000000-0000-0000-0000-000000000001', 'Too Late', 'TL')$$,
  'P0001', 'This league has ended', 'no joining an ended league');

select * from finish();
rollback;
