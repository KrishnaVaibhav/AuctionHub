-- pgTAP tests: notifications produced by triggers, privacy, follows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'nhost@test.dev'),
  ('00000000-0000-0000-0000-00000000aa02', 'nalice@test.dev'),
  ('00000000-0000-0000-0000-00000000aa03', 'nbob@test.dev');

set local role authenticated;
-- Alice follows the host
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000aa02","role":"authenticated"}';
select lives_ok($$insert into public.follows (follower_id, host_id) values ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000aa01')$$, 'alice follows host');
select throws_ok($$insert into public.follows (follower_id, host_id) values ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-00000000aa01')$$, '42501', null, 'cannot follow on behalf of others');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000aa01","role":"authenticated"}';
insert into public.auctions (id, host_id, title, settings) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aa01', 'Notify test', '{"currency":"INR"}');
insert into public.lots (id, auction_id, title, start_price) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Clock', 100);
select public.start_auction('a0000000-0000-0000-0000-000000000001');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000aa02","role":"authenticated"}';
select is((select count(*)::int from public.notifications where kind = 'live'), 1, 'follower notified when auction goes live');
select public.place_bid('a1000000-0000-0000-0000-000000000001', 100);

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000aa03","role":"authenticated"}';
select public.place_bid('a1000000-0000-0000-0000-000000000001', 110);
select is((select count(*)::int from public.notifications), 0, 'bob sees none of alice''s notifications');
select throws_ok($$insert into public.notifications (user_id, kind, title) values ('00000000-0000-0000-0000-00000000aa03', 'system', 'fake')$$, '42501', null, 'clients cannot create notifications');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000aa02","role":"authenticated"}';
select is((select count(*)::int from public.notifications where kind = 'outbid'), 1, 'alice notified when outbid');
select ok((select body like '%110%' from public.notifications where kind = 'outbid'), 'outbid shows new price');
select lives_ok($$update public.notifications set read_at = now()$$, 'can mark own notifications read');

-- Host closes: winner (bob) and host notified
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000aa01","role":"authenticated"}';
select public.close_lot_now('a1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.notifications where kind = 'sold'), 1, 'host notified of sale');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000aa03","role":"authenticated"}';
select is((select count(*)::int from public.notifications where kind = 'won'), 1, 'winner notified');
insert into public.deal_messages (lot_id, sender_id, body) values ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000aa03', 'Hi! How do I pay?');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000aa01","role":"authenticated"}';
select is((select count(*)::int from public.notifications where kind = 'deal'), 1, 'host notified of deal message');
select throws_ok($$select public.notify_closing_soon()$$, '42501', null, 'cron producer not callable by clients');

reset role;
select * from finish();
rollback;
