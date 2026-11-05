-- pgTAP tests: co-host permissions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c001', 'chost@test.dev'),
  ('00000000-0000-0000-0000-00000000c002', 'ceditor@test.dev'),
  ('00000000-0000-0000-0000-00000000c003', 'crunner@test.dev'),
  ('00000000-0000-0000-0000-00000000c004', 'cbidder@test.dev');
update public.profiles set username = 'co_editor' where id = '00000000-0000-0000-0000-00000000c002';
update public.profiles set username = 'co_runner' where id = '00000000-0000-0000-0000-00000000c003';

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}';
insert into public.auctions (id, host_id, title) values
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c001', 'Co-host sale');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('c1000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 0, 'Clock', 100);
select public.add_moderator('c0000000-0000-0000-0000-000000000001', 'co_editor');
select public.add_moderator('c0000000-0000-0000-0000-000000000001', 'co_runner');
update public.auction_moderators set can_edit = true
 where auction_id = 'c0000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000c002';
update public.auction_moderators set can_run = true
 where auction_id = 'c0000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-00000000c003';

-- Editor: sees the draft, edits lots and the auction, cannot run it or manage people.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000c002","role":"authenticated"}';
select is((select count(*)::int from public.auctions where id = 'c0000000-0000-0000-0000-000000000001'), 1, 'editor sees the draft');
update public.lots set title = 'Wall clock' where id = 'c1000000-0000-0000-0000-000000000001';
update public.auctions set description = 'Edited by co-host' where id = 'c0000000-0000-0000-0000-000000000001';
select lives_ok($$insert into public.lots (auction_id, position, title, start_price)
  values ('c0000000-0000-0000-0000-000000000001', 1, 'Lamp', 50)$$, 'editor adds a lot');
select throws_ok($$select public.start_auction('c0000000-0000-0000-0000-000000000001')$$,
  'P0001', 'Only the host can do this', 'editor cannot go live');
select throws_ok($$select public.add_moderator('c0000000-0000-0000-0000-000000000001', 'co_runner')$$,
  'P0001', 'Only the host can do this', 'editor cannot add people');
select is((select count(*)::int from public.auction_moderators where user_id = '00000000-0000-0000-0000-00000000c002' and can_run), 0, 'editor cannot see or change permissions');
update public.auction_moderators set can_run = true where user_id = '00000000-0000-0000-0000-00000000c002';

-- Runner: runs the auction, cannot edit lots, cannot delete or duplicate it.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000c003","role":"authenticated"}';
update public.lots set title = 'Hijacked' where id = 'c1000000-0000-0000-0000-000000000001';
select lives_ok($$select public.start_auction('c0000000-0000-0000-0000-000000000001')$$, 'runner goes live');
select throws_ok($$select public.duplicate_auction('c0000000-0000-0000-0000-000000000001')$$,
  'P0001', 'Only the host can do this', 'runner cannot duplicate');
select throws_ok($$select public.cancel_auction('c0000000-0000-0000-0000-000000000001')$$,
  'P0001', 'Only the host can do this', 'runner cannot cancel');
select throws_ok($$select public._cancel_auction_core('c0000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'core functions are not callable');

-- Co-hosts cannot bid; others can.
select throws_ok($$select public.place_bid('c1000000-0000-0000-0000-000000000001', 100, null)$$,
  'P0001', 'Co-hosts can''t bid in this auction', 'runner cannot bid');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000c004","role":"authenticated"}';
select lives_ok($$select public.place_bid('c1000000-0000-0000-0000-000000000001', 100, null)$$, 'bidder can bid');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000c001","role":"authenticated"}';
select is((select title from public.lots where id = 'c1000000-0000-0000-0000-000000000001'), 'Wall clock', 'editor change kept, runner edit ignored');
select is((select description from public.auctions where id = 'c0000000-0000-0000-0000-000000000001'), 'Edited by co-host', 'editor edited the auction');
select is((select can_run from public.auction_moderators where user_id = '00000000-0000-0000-0000-00000000c002'), false, 'editor could not grant themselves run');

select * from finish();
rollback;
