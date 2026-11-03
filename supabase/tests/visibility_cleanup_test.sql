-- pgTAP tests: private/unlisted visibility, invite codes, delete, retention cleanup.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'vhost@test.dev', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'member@test.dev', '{}'),
  ('00000000-0000-0000-0000-0000000000b3', 'stranger@test.dev', '{}');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
insert into public.auctions (id, host_id, title, visibility, settings) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'Private sale', 'private', '{"chat":{"slow_mode_s":0}}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 0, 'Secret item', 100);
select lives_ok($$insert into public.auctions (host_id, title, visibility) values ('00000000-0000-0000-0000-0000000000b1', 'Returning check', 'private') returning id$$,
  'host can create an auction and read it back (INSERT ... RETURNING)');
select lives_ok($$select public.start_auction('50000000-0000-0000-0000-000000000001')$$, 'host starts private auction');
select ok((select char_length(public.get_invite_code('50000000-0000-0000-0000-000000000001')) = 8), 'host gets invite code');

-- Stranger: sees nothing, cannot bid or chat
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select count(*)::int from public.auctions where id = '50000000-0000-0000-0000-000000000001'), 0, 'stranger cannot see private auction');
select is((select count(*)::int from public.lots where auction_id = '50000000-0000-0000-0000-000000000001'), 0, 'stranger cannot see lots');
select is((select can_view from public.auction_preview('50000000-0000-0000-0000-000000000001')), false, 'preview says no access');
select is((select title from public.auction_preview('50000000-0000-0000-0000-000000000001')), 'Private sale', 'preview shows title for invite page');
select throws_ok($$select public.place_bid('60000000-0000-0000-0000-000000000001', 100)$$,
  'P0001', 'This auction is private', 'stranger cannot bid');
select throws_ok($$insert into public.chat_messages (auction_id, user_id, body) values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b3', 'hi')$$,
  'P0001', 'This auction is private', 'stranger cannot chat');
select throws_ok($$select public.join_private_auction('50000000-0000-0000-0000-000000000001', 'WRONG123')$$,
  'P0001', 'That invite code is not valid', 'wrong code rejected');
select throws_ok($$select public.get_invite_code('50000000-0000-0000-0000-000000000001')$$,
  'P0001', 'Only the host can do this', 'only host reads invite code');

-- Member joins with the right code
reset role;
create temporary table _code as select invite_code from public.auction_secrets where auction_id = '50000000-0000-0000-0000-000000000001';
grant select on _code to authenticated;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select ok(public.join_private_auction('50000000-0000-0000-0000-000000000001', lower((select invite_code from _code))), 'member joins with code (case-insensitive)');
select is((select count(*)::int from public.lots where auction_id = '50000000-0000-0000-0000-000000000001'), 1, 'member sees lots');
select is((public.place_bid('60000000-0000-0000-0000-000000000001', 100)) ->> 'status', 'leading', 'member can bid');
select throws_ok($$select * from public.auction_secrets$$, '42501', null, 'member cannot read invite codes');

-- Delete rules
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$select public.delete_auction('50000000-0000-0000-0000-000000000001')$$,
  'P0001', 'End or cancel the auction before deleting it', 'cannot delete a live auction');
select lives_ok($$select public.end_auction_now('50000000-0000-0000-0000-000000000001')$$, 'host ends auction');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$select public.delete_auction('50000000-0000-0000-0000-000000000001')$$,
  'P0001', 'Only the host can do this', 'non-host cannot delete');
select throws_ok($$select public.cleanup_stale_data()$$, '42501', null, 'cleanup not callable by clients');
select throws_ok($$select * from public.storage_orphans()$$, '42501', null, 'orphan list not callable by clients');

-- Retention: age the auction, run cleanup as owner
reset role;
insert into public.chat_messages (auction_id, user_id, kind, body)
values ('50000000-0000-0000-0000-000000000001', null, 'system', 'old line');
update public.auctions set starts_at = now() - interval '101 days', ends_at = now() - interval '100 days' where id = '50000000-0000-0000-0000-000000000001';
update public.lots set ends_at = now() - interval '100 days' where auction_id = '50000000-0000-0000-0000-000000000001';
select ok((public.cleanup_stale_data() ->> 'chat_old')::int >= 1, 'old chat purged');
select is((select count(*)::int from public.chat_messages where auction_id = '50000000-0000-0000-0000-000000000001'), 0, 'no chat left');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select public.delete_auction('50000000-0000-0000-0000-000000000001');
reset role;
select is((select count(*)::int from public.lots where auction_id = '50000000-0000-0000-0000-000000000001'), 0, 'delete removes lots and children');

select * from finish();
rollback;
