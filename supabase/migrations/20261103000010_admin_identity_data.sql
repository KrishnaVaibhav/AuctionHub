-- Admin: expose everything the sign-in provider shared (photo, real name,
-- identities), plus sessions (IP, device) and auth sign-in history.
-- Secrets (password hashes, tokens) are never returned.

drop function if exists public.admin_users(text, int, int);
create function public.admin_users(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, email text, username text, display_name text, avatar_url text, provider text,
  provider_name text, provider_avatar text, phone text,
  created_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean, banned_until timestamptz,
  is_admin boolean, auctions_hosted bigint, bids bigint, lots_won bigint, share_contact boolean, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_platform_admin();
  return query
    with base as (
      select u.id, u.email::text as email, p.username, p.display_name, p.avatar_url,
             coalesce(u.raw_app_meta_data ->> 'provider', 'email') as provider,
             coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') as provider_name,
             coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') as provider_avatar,
             coalesce(u.phone::text, cs.phone) as phone,
             u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null as email_confirmed, p.banned_until,
             coalesce(cs.share_contact, false) as share_contact
        from auth.users u
        left join public.profiles p on p.id = u.id
        left join public.contact_settings cs on cs.user_id = u.id
       where p_search is null or p_search = ''
          or u.email ilike '%' || p_search || '%'
          or p.username ilike '%' || p_search || '%'
          or p.display_name ilike '%' || p_search || '%'
          or u.raw_user_meta_data ->> 'full_name' ilike '%' || p_search || '%'
          or u.raw_user_meta_data ->> 'name' ilike '%' || p_search || '%'
          or u.id::text = p_search
    )
    select b.id, b.email, b.username, b.display_name, b.avatar_url, b.provider,
           b.provider_name, b.provider_avatar, b.phone,
           b.created_at, b.last_sign_in_at, b.email_confirmed, b.banned_until,
           exists (select 1 from public.platform_admins a where a.user_id = b.id),
           (select count(*) from public.auctions x where x.host_id = b.id),
           (select count(*) from public.bids x where x.bidder_id = b.id),
           (select count(*) from public.lots x where x.current_winner_id = b.id and x.status = 'sold'),
           b.share_contact,
           count(*) over ()
      from base b
     order by b.created_at desc
     limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_platform_admin();
  return jsonb_build_object(
    'account', (select jsonb_build_object(
                  'id', u.id, 'email', u.email, 'phone', u.phone, 'role', u.role,
                  'created_at', u.created_at, 'updated_at', u.updated_at, 'last_sign_in_at', u.last_sign_in_at,
                  'email_confirmed_at', u.email_confirmed_at, 'phone_confirmed_at', u.phone_confirmed_at,
                  'banned_until_auth', u.banned_until, 'is_anonymous', u.is_anonymous,
                  'app_metadata', u.raw_app_meta_data, 'user_metadata', u.raw_user_meta_data)
                  from auth.users u where u.id = p_user_id),
    'provider_name', (select coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name') from auth.users u where u.id = p_user_id),
    'provider_avatar', (select coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') from auth.users u where u.id = p_user_id),
    'identities', (select coalesce(jsonb_agg(jsonb_build_object(
                      'provider', i.provider, 'provider_id', i.provider_id, 'email', i.email,
                      'created_at', i.created_at, 'last_sign_in_at', i.last_sign_in_at, 'data', i.identity_data)
                    order by i.created_at), '[]')
                     from auth.identities i where i.user_id = p_user_id),
    'sessions', (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]')
                   from (select * from auth.sessions where user_id = p_user_id order by created_at desc limit 20) s),
    'auth_events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'ip', e.ip_address,
                       'action', e.payload ->> 'action', 'provider', e.payload -> 'traits' ->> 'provider') order by e.created_at desc), '[]')
                      from (select * from auth.audit_log_entries
                             where payload ->> 'actor_id' = p_user_id::text
                             order by created_at desc limit 50) e),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = p_user_id),
    'contact', (select to_jsonb(c) from public.contact_settings c where c.user_id = p_user_id),
    'auctions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'status', a.status, 'mode', a.mode,
                    'visibility', a.visibility, 'created_at', a.created_at) order by a.created_at desc), '[]')
                   from public.auctions a where a.host_id = p_user_id),
    'bids', (select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]') from (
               select jsonb_build_object('id', b.id, 'amount', b.amount, 'is_auto', b.is_auto, 'created_at', b.created_at,
                        'lot', l.title, 'auction_id', l.auction_id) x
                 from public.bids b join public.lots l on l.id = b.lot_id
                where b.bidder_id = p_user_id order by b.id desc limit 100) s),
    'wins', (select coalesce(jsonb_agg(jsonb_build_object('lot', l.title, 'price', l.current_bid, 'auction_id', l.auction_id, 'ended', l.ends_at)), '[]')
               from public.lots l where l.current_winner_id = p_user_id and l.status = 'sold'),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'short', t.short_name, 'purse_left', t.purse_left, 'auction_id', t.auction_id)), '[]')
                from public.league_teams t where t.owner_id = p_user_id),
    'chat', (select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]') from (
               select jsonb_build_object('id', c.id, 'body', c.body, 'auction_id', c.auction_id, 'created_at', c.created_at, 'deleted', c.deleted_at is not null) x
                 from public.chat_messages c where c.user_id = p_user_id order by c.id desc limit 100) s),
    'deal_messages', (select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]') from (
               select jsonb_build_object('id', d.id, 'body', d.body, 'lot', l.title, 'created_at', d.created_at) x
                 from public.deal_messages d join public.lots l on l.id = d.lot_id
                where d.sender_id = p_user_id order by d.id desc limit 100) s),
    'support', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'category', s.category, 'message', s.message, 'status', s.status, 'created_at', s.created_at) order by s.created_at desc), '[]')
                  from public.support_requests s where s.user_id = p_user_id),
    'memberships', (select coalesce(jsonb_agg(m.auction_id), '[]') from public.auction_members m where m.user_id = p_user_id)
  );
end;
$$;

revoke execute on function public.admin_users(text, int, int) from public, anon;
grant execute on function public.admin_users(text, int, int) to authenticated;
