-- pgTAP tests: price hints and host webhooks.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ab01', 'whost@test.dev'),
  ('00000000-0000-0000-0000-00000000ab02', 'wbuyer@test.dev');

-- Past public sales; the title filter keeps other test data out.
insert into public.auctions (id, host_id, title, category, status, visibility) values
  ('ab000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ab01', 'Old sale', 'books', 'ended', 'public');
insert into public.lots (auction_id, title, start_price, status, current_bid, current_winner_id, ends_at, custom_fields)
select 'ab000000-0000-0000-0000-000000000001', 'Hint test book ' || n, 1, 'sold', n * 100, '00000000-0000-0000-0000-00000000ab02', now() - interval '1 day', '{"hint":"x"}'
  from generate_series(1, 5) n;

select is((public.price_hint('books', 'INR', 'Hint test book') ->> 'median')::numeric, 300::numeric, 'median of past sales');
select is((public.price_hint('books', 'INR', 'Hint test book') ->> 'count')::int, 5, 'counts sales');
select is(public.price_hint('no-such-category'), null, 'no hint without enough sales');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ab01","role":"authenticated"}';
select throws_ok($$insert into public.host_webhooks (url) values ('https://192.168.1.5/hook')$$, 'P0001',
  'Webhook URL must be a public https address', 'private addresses refused');
select throws_ok($$insert into public.host_webhooks (url) values ('http://example.com/hook')$$, 'P0001',
  'Webhook URL must be a public https address', 'https required');
select lives_ok($$insert into public.host_webhooks (url) values ('https://example.com/hook')$$, 'host adds a webhook');
select is((select host_id from public.host_webhooks where url = 'https://example.com/hook'), '00000000-0000-0000-0000-00000000ab01'::uuid, 'owner set by the server');

insert into public.auctions (id, host_id, title) values ('ab000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000ab01', 'Hooked');
insert into public.lots (auction_id, title, start_price) values ('ab000000-0000-0000-0000-000000000002', 'Item', 10);
reset role;
create temporary table _before as select count(*) as n from net.http_request_queue;
set local role authenticated;
select public.start_auction('ab000000-0000-0000-0000-000000000002');
reset role;
select ok((select count(*) from net.http_request_queue) > (select n from _before), 'auction.live queued a signed request');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000ab02","role":"authenticated"}';
select is((select count(*)::int from public.host_webhooks), 0, 'others cannot see webhooks');

reset role;
select * from finish();
rollback;
