-- pgTAP tests: closing expired lots on demand, free-start lots, lot links in notifications.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f101', 'uxhost@test.dev', '{"display_name":"UX Host"}'),
  ('00000000-0000-0000-0000-00000000f10a', 'uxalice@test.dev', '{"display_name":"UX Alice"}'),
  ('00000000-0000-0000-0000-00000000f10b', 'uxbob@test.dev', '{"display_name":"UX Bob"}');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f101","role":"authenticated"}';
insert into public.auctions (id, host_id, title, settings) values
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f101', 'UX auction',
   '{"currency":"INR","anti_snipe_seconds":0,"lot_duration_minutes":10,"custom_bids":false}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('f2100000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 0, 'Free start', 0),
  ('f2100000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 1, 'Later', 100);
select public.start_auction('f2000000-0000-0000-0000-000000000001');

-- A lot that starts at 0: the first bid is one increment, even with custom bids off.
select is(public.min_next_bid('f2100000-0000-0000-0000-000000000001'), 10::numeric, 'first bid on a free-start lot is one increment');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f10a","role":"authenticated"}';
select is((public.place_bid('f2100000-0000-0000-0000-000000000001', 10)) ->> 'status', 'leading',
  'the one-increment first bid is accepted with custom bids off');

-- Outbid: the notification links straight to the lot.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f10b","role":"authenticated"}';
select lives_ok($$select public.place_bid('f2100000-0000-0000-0000-000000000001', 20)$$, 'bob outbids alice');
reset role;
select is((select link from public.notifications where user_id = '00000000-0000-0000-0000-00000000f10a' and kind = 'outbid'),
  '/a/f2000000-0000-0000-0000-000000000001?lot=f2100000-0000-0000-0000-000000000001', 'outbid notification links to the lot');

-- Closing on demand: only lots whose time is up, and anyone may ask.
update public.lots set ends_at = now() - interval '1 second' where id = 'f2100000-0000-0000-0000-000000000001';
set local role anon;
select lives_ok($$select public.close_due_lots('f2000000-0000-0000-0000-000000000001')$$, 'a signed-out viewer can ask to close due lots');
reset role;
select is((select status::text from public.lots where id = 'f2100000-0000-0000-0000-000000000001'), 'sold', 'the expired lot is sold at once');
select is((select current_winner_id from public.lots where id = 'f2100000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-00000000f10b'::uuid, 'to the leader');
select is((select status::text from public.lots where id = 'f2100000-0000-0000-0000-000000000002'), 'open', 'a lot with time left stays open');
select is((select status::text from public.auctions where id = 'f2000000-0000-0000-0000-000000000001'), 'live', 'the auction keeps running');

-- When the last lot closes, the auction ends.
update public.lots set ends_at = now() - interval '1 second' where id = 'f2100000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f10a","role":"authenticated"}';
select public.close_due_lots('f2000000-0000-0000-0000-000000000001');
reset role;
select is((select status::text from public.lots where id = 'f2100000-0000-0000-0000-000000000002'), 'unsold', 'the last lot closes unsold');
select is((select status::text from public.auctions where id = 'f2000000-0000-0000-0000-000000000001'), 'ended', 'and the auction ends');

select * from finish();
rollback;
