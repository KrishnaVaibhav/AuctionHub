-- pgTAP tests: bingo cards are dealt and checked by the server.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000b101', 'bhost@test.dev'),
  ('00000000-0000-0000-0000-00000000b102', 'bviewer@test.dev'),
  ('00000000-0000-0000-0000-00000000b103', 'bbidder@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000b101","role":"authenticated"}';
insert into public.auctions (id, host_id, title, settings) values
  ('b2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b101', 'Bingo night', '{"currency":"INR","lot_duration_minutes":30}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('b2100000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 0, 'Lamp', 100),
  ('b2100000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 1, 'Clock', 100);
select public.start_auction('b2000000-0000-0000-0000-000000000001');

-- The viewer has no card until they open the game.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000b102","role":"authenticated"}';
select throws_ok($$select public.claim_bingo('b2000000-0000-0000-0000-000000000001')$$, 'P0001', 'No bingo card yet', 'no claim without a card');

create temporary table _s1 as select public.bingo_state('b2000000-0000-0000-0000-000000000001') as j;
select is(jsonb_array_length((select j -> 'card' from _s1)), 9, 'card has nine squares');
select is((select count(distinct x)::int from _s1, jsonb_array_elements_text(j -> 'card') x), 9, 'squares are all different');
select is(public.bingo_state('b2000000-0000-0000-0000-000000000001') -> 'card', (select j -> 'card' from _s1), 'card stays the same');
select is((select j -> 'hits' from _s1), '[]'::jsonb, 'nothing has happened yet');

-- Fix the card so the test knows the top row: first bid, extension, unsold.
reset role;
update public.bingo_cards set squares = array['first_bid', 'extend', 'unsold', 'double', 'triple', 'fast', 'buy_now', 'big_jump', 'showdown']
 where user_id = '00000000-0000-0000-0000-00000000b102';
set local role authenticated;

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000b103","role":"authenticated"}';
select public.place_bid('b2100000-0000-0000-0000-000000000001', 100);

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000b102","role":"authenticated"}';
select ok(public.bingo_state('b2000000-0000-0000-0000-000000000001') -> 'hits' ? 'first_bid', 'first bid is seen by the server');
select throws_ok($$select public.claim_bingo('b2000000-0000-0000-0000-000000000001')$$, 'P0001', 'No complete line yet', 'a partial line pays nothing');

-- Host adds time, then a lot goes unsold.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000b101","role":"authenticated"}';
select public.set_lot_end('b2100000-0000-0000-0000-000000000002', now() + interval '2 hours');
select is((select extensions from public.lots where id = 'b2100000-0000-0000-0000-000000000002'), 1, 'extension counted');
select public.close_lot_now('b2100000-0000-0000-0000-000000000002');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000b102","role":"authenticated"}';
select is((public.bingo_state('b2000000-0000-0000-0000-000000000001') ->> 'line')::boolean, true, 'server sees the line');
select lives_ok($$select public.claim_bingo('b2000000-0000-0000-0000-000000000001')$$, 'real line can be claimed');
select ok(exists (select 1 from public.user_badges where user_id = '00000000-0000-0000-0000-00000000b102' and badge = 'bingo'), 'bingo badge awarded');
select public.claim_bingo('b2000000-0000-0000-0000-000000000001');
select is((select xp from public.profiles where id = '00000000-0000-0000-0000-00000000b102'), 25, 'claiming twice pays once');

-- Guests see the hits but get no card.
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select is(public.bingo_state('b2000000-0000-0000-0000-000000000001') -> 'card', 'null'::jsonb, 'guests get no card');

select * from finish();
rollback;
