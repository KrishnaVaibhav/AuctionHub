-- pgTAP tests: unique team colours; hosts can turn off custom bid amounts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d101', 'chost@test.dev'),
  ('00000000-0000-0000-0000-00000000d102', 'cteam1@test.dev'),
  ('00000000-0000-0000-0000-00000000d103', 'cteam2@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d101","role":"authenticated"}';
insert into public.auctions (id, host_id, title, mode, starts_at, settings) values
  ('d2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000d101', 'Colour league', 'league', now() + interval '1 day',
   '{"currency":"INR","custom_bids":false,"increments":[[0,10]],"league":{"purse":1000,"squad_max":2,"min_base":100,"lot_seconds":30,"bid_seconds":15,"break_seconds":0}}'),
  ('d2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000d101', 'Fixed steps', 'standard', null,
   '{"currency":"INR","custom_bids":false,"lot_duration_minutes":30}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('d2100000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000001', 0, 'Player A', 100),
  ('d2100000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000002', 0, 'Vase', 100);
select public.schedule_auction('d2000000-0000-0000-0000-000000000001');
select public.start_auction('d2000000-0000-0000-0000-000000000002');

-- Colours
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d102","role":"authenticated"}';
select lives_ok($$select public.join_league('d2000000-0000-0000-0000-000000000001', 'Reds', 'RED', '#EF4444')$$, 'first team takes red');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d103","role":"authenticated"}';
select lives_ok($$select public.join_league('d2000000-0000-0000-0000-000000000001', 'Also red', 'ARD', '#ef4444')$$, 'joining with a taken colour still works');
select is((select color from public.league_teams where short_name = 'ARD'), '#f59e0b', 'and gets the first free colour instead');
reset role;
select throws_ok($$update public.league_teams set color = '#ef4444' where short_name = 'ARD'$$,
  'P0001', 'That colour is taken. Pick another.', 'two teams can never share a colour');
set local role authenticated;

-- Standard auction with custom bids off
select throws_ok($$select public.place_bid('d2100000-0000-0000-0000-000000000002', 150)$$,
  'P0001', null, 'a custom amount is refused');
select throws_ok($$select public.place_bid('d2100000-0000-0000-0000-000000000002', 100, 500)$$,
  'P0001', 'Auto-bid is off in this auction', 'auto-bid is refused');
select is(public.place_bid('d2100000-0000-0000-0000-000000000002', 100) ->> 'status', 'leading', 'the next bid works');

-- League with custom bids off
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d101","role":"authenticated"}';
select public.start_auction('d2000000-0000-0000-0000-000000000001');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000d102","role":"authenticated"}';
select throws_ok($$select public.league_bid('d2100000-0000-0000-0000-000000000001', 200)$$,
  'P0001', null, 'a league jump bid is refused');
select lives_ok($$select public.league_bid('d2100000-0000-0000-0000-000000000001', 100)$$, 'the next league bid works');
select is((select current_bid from public.lots where id = 'd2100000-0000-0000-0000-000000000001'), 100.00::numeric(12,2), 'price moved by one step only');

select * from finish();
rollback;
