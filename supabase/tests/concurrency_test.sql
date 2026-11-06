-- pgTAP tests: lock order fixes keep the flows working, and repeated ticks open one player.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000f101', 'khost@test.dev'),
  ('00000000-0000-0000-0000-00000000f102', 'kteam@test.dev');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f101","role":"authenticated"}';
insert into public.auctions (id, host_id, title, mode, settings) values
  ('f2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f101', 'Tick league', 'league',
   '{"currency":"INR","increments":[[0,10]],"league":{"purse":1000,"squad_max":3,"min_base":100,"lot_seconds":30,"bid_seconds":15,"break_seconds":0}}');
insert into public.lots (id, auction_id, position, title, start_price) values
  ('f2100000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001', 0, 'P1', 100),
  ('f2100000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-000000000001', 1, 'P2', 100),
  ('f2100000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-000000000001', 2, 'P3', 100);
select public.start_auction('f2000000-0000-0000-0000-000000000001');

-- Timer runs out; many viewers tick.
reset role;
update public.lots set ends_at = now() - interval '1 second' where id = 'f2100000-0000-0000-0000-000000000001';
set local role anon;
select lives_ok($$select public.league_tick('f2000000-0000-0000-0000-000000000001')$$, 'a viewer ticks');
select public.league_tick('f2000000-0000-0000-0000-000000000001');
select public.league_tick('f2000000-0000-0000-0000-000000000001');
reset role;
select is((select count(*)::int from public.lots where auction_id = 'f2000000-0000-0000-0000-000000000001' and status = 'open'), 1,
  'repeated ticks put exactly one player on the block');
select is((select status::text from public.lots where id = 'f2100000-0000-0000-0000-000000000001'), 'unsold', 'expired player closed');

-- The scheduler does the same work and stays idempotent.
select lives_ok($$select public.run_auction_jobs()$$, 'scheduler runs');
select is((select count(*)::int from public.lots where auction_id = 'f2000000-0000-0000-0000-000000000001' and status = 'open'), 1,
  'still one player after the scheduler');

-- Host controls still work with the new lock order.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000f101","role":"authenticated"}';
select lives_ok($$select public.set_lot_end('f2100000-0000-0000-0000-000000000002', now() + interval '1 hour')$$, 'host retimes the open player');
reset role;
select ok(pg_get_functiondef('public._assert_host(uuid)'::regprocedure) like '%for no key update%', 'host lock no longer blocks bids and chat');

select * from finish();
rollback;
