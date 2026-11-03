-- pgTAP tests: support form is write-only for users, readable by admins.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'sadmin@test.dev'),
  ('00000000-0000-0000-0000-0000000000e2', 'suser@test.dev');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000000e1');

set local role anon;
select lives_ok($$insert into public.support_requests (category, message) values ('question', 'Hello, how do leagues work?')$$, 'anonymous visitor can submit');
select throws_ok($$select * from public.support_requests$$, '42501', null, 'anonymous cannot read requests');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok($$insert into public.support_requests (user_id, category, message) values ('00000000-0000-0000-0000-0000000000e2', 'data', 'Please delete my account data')$$, 'user can submit');
select throws_ok($$insert into public.support_requests (user_id, category, message) values ('00000000-0000-0000-0000-0000000000e1', 'other', 'Pretending to be someone else')$$, '42501', null, 'cannot submit as another user');
select is((select count(*)::int from public.support_requests), 0, 'user cannot read requests');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select is((select count(*)::int from public.admin_support('open')), 2, 'admin sees requests');
select is((select user_email from public.admin_support('open') where category = 'data'), 'suser@test.dev', 'admin sees sender account');

reset role;
select * from finish();
rollback;
