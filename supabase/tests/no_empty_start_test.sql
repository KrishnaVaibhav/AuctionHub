-- pgTAP tests: a scheduled auction with no lots waits instead of going live empty.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e101', 'ehost@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000e101","role":"authenticated"}';
insert into public.auctions (id, host_id, title, settings) values
  ('e2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e101', 'Empty for now', '{"currency":"INR"}');
reset role;
update public.auctions set status = 'scheduled', starts_at = now() - interval '1 minute'
 where id = 'e2000000-0000-0000-0000-000000000001';

select public.run_auction_jobs();
select is((select status::text from public.auctions where id = 'e2000000-0000-0000-0000-000000000001'), 'scheduled',
  'the scheduler leaves an empty auction scheduled');

insert into public.lots (id, auction_id, position, title, start_price) values
  ('e2100000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', 0, 'First lot', 100);
select public.run_auction_jobs();
select is((select status::text from public.auctions where id = 'e2000000-0000-0000-0000-000000000001'), 'live',
  'it starts once a lot is added');
select is((select status::text from public.lots where id = 'e2100000-0000-0000-0000-000000000001'), 'open', 'the lot is open');

set local role authenticated;
insert into public.auctions (id, host_id, title, settings) values
  ('e2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000e101', 'Still empty', '{"currency":"INR"}');
select throws_ok($$select public.start_auction('e2000000-0000-0000-0000-000000000002')$$,
  'P0001', 'Add at least one lot first', 'a manual start without lots is refused');

select * from finish();
rollback;
