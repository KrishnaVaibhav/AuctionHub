-- pgTAP tests: moderators by username, watchlist privacy, no TRUNCATE for clients.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f2', 'mhost@test.dev'),
  ('00000000-0000-0000-0000-0000000000f3', 'mod@test.dev'),
  ('00000000-0000-0000-0000-0000000000f4', 'other@test.dev');
update public.profiles set username = 'the_mod' where id = '00000000-0000-0000-0000-0000000000f3';

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
insert into public.auctions (id, host_id, title, visibility, settings) values
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f2', 'Mod test', 'private', '{"chat":{"slow_mode_s":0}}');
insert into public.lots (id, auction_id, title, start_price) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Item', 10);
select public.start_auction('90000000-0000-0000-0000-000000000001');

select is(public.add_moderator('90000000-0000-0000-0000-000000000001', '@THE_MOD'), '00000000-0000-0000-0000-0000000000f3'::uuid, 'host adds moderator by username');
select throws_ok($$select public.add_moderator('90000000-0000-0000-0000-000000000001', 'nobody_here')$$, 'P0001', 'No user with that username', 'unknown username rejected');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}';
select throws_ok($$select public.add_moderator('90000000-0000-0000-0000-000000000001', 'the_mod')$$, 'P0001', 'Only the host can do this', 'non-host cannot add moderators');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select is((select count(*)::int from public.auctions where id = '90000000-0000-0000-0000-000000000001'), 1, 'moderator sees private auction');
select ok(public.is_auction_staff('90000000-0000-0000-0000-000000000001'), 'moderator is staff');
select lives_ok($$insert into public.watchlist (user_id, lot_id) values ('00000000-0000-0000-0000-0000000000f3', '91000000-0000-0000-0000-000000000001')$$, 'user watches a lot');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f4","role":"authenticated"}';
select is((select count(*)::int from public.watchlist), 0, 'watchlists are private');
select throws_ok($$truncate public.watchlist$$, '42501', null, 'authenticated cannot truncate');
set local role anon;
select throws_ok($$truncate public.auction_moderators$$, '42501', null, 'anon cannot truncate');

reset role;
select * from finish();
rollback;
