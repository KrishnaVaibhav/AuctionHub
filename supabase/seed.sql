-- Local development test accounts. Loaded by `supabase start` / `supabase db reset`
-- only; `supabase db push` never sends this file to production.
--
--   Role                 Email                    Password
--   Host + site admin    host@auctionhub.test     bzw90rJRlnkgFAA5
--   Bidder               bidder1@auctionhub.test  4K7dvx1PIOZfnNxp
--   Bidder               bidder2@auctionhub.test  Wq_nv-f9HLoCn7dF
--
-- These are throwaway local values. Never reuse them anywhere real.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt(u.pw, extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', u.name), now(), now(),
       '', '', '', ''
  from (values
    ('5eed0000-0000-0000-0000-000000000001'::uuid, 'host@auctionhub.test',    'bzw90rJRlnkgFAA5', 'Test Host'),
    ('5eed0000-0000-0000-0000-000000000002'::uuid, 'bidder1@auctionhub.test', '4K7dvx1PIOZfnNxp', 'Test Bidder One'),
    ('5eed0000-0000-0000-0000-000000000003'::uuid, 'bidder2@auctionhub.test', 'Wq_nv-f9HLoCn7dF', 'Test Bidder Two')
  ) as u (id, email, pw, name)
on conflict (id) do nothing;

-- Email sign-in needs a matching identity row.
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), now(), now(), now()
  from auth.users u
 where u.id in ('5eed0000-0000-0000-0000-000000000001', '5eed0000-0000-0000-0000-000000000002', '5eed0000-0000-0000-0000-000000000003')
on conflict do nothing;

-- Readable usernames (the signup trigger creates random ones).
update public.profiles set username = 'test_host'    where id = '5eed0000-0000-0000-0000-000000000001';
update public.profiles set username = 'test_bidder1' where id = '5eed0000-0000-0000-0000-000000000002';
update public.profiles set username = 'test_bidder2' where id = '5eed0000-0000-0000-0000-000000000003';

-- The host can open Admin locally.
insert into public.platform_admins (user_id) values ('5eed0000-0000-0000-0000-000000000001') on conflict do nothing;
