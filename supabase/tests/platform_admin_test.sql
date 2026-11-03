-- pgTAP tests: platform super admin sees everything; nobody else can.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner@test.dev', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'host3@test.dev', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'user3@test.dev', '{}');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000c1');

-- Host makes a private draft with a secret reserve; user stores private contact info
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
insert into public.auctions (id, host_id, title, visibility) values
  ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'Secret draft', 'private');
insert into public.lots (id, auction_id, title, start_price) values
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'Hidden lot', 10);
insert into public.lot_reserves (lot_id, reserve_price) values ('80000000-0000-0000-0000-000000000001', 99);
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}';
insert into public.contact_settings (user_id, share_contact, phone) values ('00000000-0000-0000-0000-0000000000c3', false, '+91 1');

-- Regular user: nothing extra, no admin RPCs
select is(public.is_platform_admin(), false, 'regular user is not admin');
select is((select count(*)::int from public.auctions where id = '70000000-0000-0000-0000-000000000001'), 0, 'user cannot see private draft');
select throws_ok($$select public.admin_overview()$$, 'P0001', 'Admins only', 'user cannot call admin_overview');
select throws_ok($$select * from public.admin_users()$$, 'P0001', 'Admins only', 'user cannot list users');
select throws_ok($$select public.admin_set_ban('00000000-0000-0000-0000-0000000000c2', now() + interval '1 day')$$, 'P0001', 'Admins only', 'user cannot ban');
select throws_ok($$insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000c3')$$, '42501', null, 'user cannot make themselves admin');

-- Admin: sees everything
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select is(public.is_platform_admin(), true, 'owner is admin');
select is((select count(*)::int from public.auctions where id = '70000000-0000-0000-0000-000000000001'), 1, 'admin sees private draft');
select is((select count(*)::int from public.lots where id = '80000000-0000-0000-0000-000000000001'), 1, 'admin sees its lots');
select is((select reserve_price from public.lot_reserves where lot_id = '80000000-0000-0000-0000-000000000001'), 99.00::numeric(12,2), 'admin sees secret reserve');
select is((select phone from public.contact_settings where user_id = '00000000-0000-0000-0000-0000000000c3'), '+91 1', 'admin sees private contact');
select ok((public.admin_overview() ->> 'users')::int >= 3, 'overview counts users');
select is((select email from public.admin_users('host3') limit 1), 'host3@test.dev', 'admin searches users by email');
select is((public.admin_user_detail('00000000-0000-0000-0000-0000000000c3') -> 'contact' ->> 'phone'), '+91 1', 'user detail includes contact');

-- Moderation is audited
select lives_ok($$select public.admin_set_ban('00000000-0000-0000-0000-0000000000c3', now() + interval '1 day', 'spam')$$, 'admin bans user');
select is((select action from public.admin_audit_log order by id desc limit 1), 'ban', 'ban is audited');
select throws_ok($$select public.admin_set_ban('00000000-0000-0000-0000-0000000000c1', now() + interval '1 day')$$, 'P0001', 'You cannot ban yourself', 'no self-ban');

reset role;
select * from finish();
rollback;
