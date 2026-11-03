-- pgTAP tests: chat link blocking, word masking, fraud signals access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000dd01', 'shost@test.dev'),
  ('00000000-0000-0000-0000-00000000dd02', 'suser2@test.dev'),
  ('00000000-0000-0000-0000-00000000dd03', 'sadmin2@test.dev');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000dd03');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000dd03","role":"authenticated"}';
select lives_ok($$insert into public.blocked_words (word) values ('scamword')$$, 'admin adds blocked word');
select ok((public.admin_fraud_signals() ? 'bidding_pairs'), 'admin gets fraud signals');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000dd01","role":"authenticated"}';
insert into public.auctions (id, host_id, title, settings) values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000dd01', 'Safe chat', '{"chat":{"slow_mode_s":0}}');
insert into public.lots (auction_id, title, start_price) values ('d0000000-0000-0000-0000-000000000001', 'x', 1);
select public.start_auction('d0000000-0000-0000-0000-000000000001');
select lives_ok($$insert into public.chat_messages (auction_id, user_id, body) values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000dd01', 'Pay at https://example.com')$$, 'host (staff) may post links');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000dd02","role":"authenticated"}';
select throws_ok($$insert into public.chat_messages (auction_id, user_id, body) values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000dd02', 'cheap deals at www.example.com')$$,
  'P0001', 'Links are not allowed in this chat', 'user links blocked');
select throws_ok($$insert into public.chat_messages (auction_id, user_id, body) values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000dd02', 'dm me on t.me/someone')$$,
  'P0001', 'Links are not allowed in this chat', 'telegram links blocked');
insert into public.chat_messages (auction_id, user_id, body) values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000dd02', 'This is a ScamWord offer');
select is((select body from public.chat_messages where user_id = '00000000-0000-0000-0000-00000000dd02' order by id desc limit 1), 'This is a ******** offer', 'blocked word masked');
select lives_ok($$insert into public.chat_messages (auction_id, user_id, body) values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000dd02', 'Price is 2.5 lakh, ok?')$$, 'decimals are not links');
select throws_ok($$select public.admin_fraud_signals()$$, 'P0001', 'Admins only', 'users cannot see fraud signals');
select throws_ok($$insert into public.blocked_words (word) values ('mine')$$, '42501', null, 'users cannot edit blocked words');

reset role;
select * from finish();
rollback;
