-- Platform super admin: full read access to everything, moderation actions,
-- and monitoring RPCs. Admins are granted only by direct SQL (no UI, no RPC):
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = '<owner email>';

create table public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;
grant execute on function public.is_platform_admin() to anon, authenticated;

create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid not null references auth.users (id) on delete cascade,
  action      text not null,
  target      text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index admin_audit_created_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select on public.admin_audit_log to authenticated;
create policy "admin reads audit" on public.admin_audit_log for select to authenticated using (public.is_platform_admin());

create or replace function public._assert_platform_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Admins only' using errcode = 'P0001';
  end if;
  return auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Visibility: admins see every auction and everything inside it
-- ---------------------------------------------------------------------------
create or replace function public.auction_visible(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.auctions a
     where a.id = p_auction_id
       and (
         a.host_id = (select auth.uid())
         or (
           a.status <> 'draft'
           and (
             a.visibility <> 'private'
             or exists (select 1 from public.auction_members m where m.auction_id = a.id and m.user_id = (select auth.uid()))
             or exists (select 1 from public.auction_moderators m where m.auction_id = a.id and m.user_id = (select auth.uid()))
           )
         )
       )
  );
$$;

create or replace function public.is_auction_staff(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or public.is_auction_host(p_auction_id)
      or exists (
        select 1 from public.auction_moderators m
        where m.auction_id = p_auction_id and m.user_id = (select auth.uid())
      );
$$;

drop policy "auctions readable" on public.auctions;
create policy "auctions readable" on public.auctions for select
  using (
    host_id = (select auth.uid())
    or (status <> 'draft' and (visibility <> 'private' or public.is_auction_member(id)))
    or public.is_platform_admin()
  );

-- Private per-user tables: add an admin read policy alongside the owner policy.
create policy "admin reads reserves"  on public.lot_reserves     for select to authenticated using (public.is_platform_admin());
create policy "admin reads proxies"   on public.proxy_bids       for select to authenticated using (public.is_platform_admin());
create policy "admin reads mutes"     on public.chat_mutes       for select to authenticated using (public.is_platform_admin());
create policy "admin reads watchlist" on public.watchlist        for select to authenticated using (public.is_platform_admin());
create policy "admin reads contacts"  on public.contact_settings for select to authenticated using (public.is_platform_admin());
create policy "admin reads deals"     on public.deal_messages    for select to authenticated using (public.is_platform_admin());
create policy "admin reads members"   on public.auction_members  for select to authenticated using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Monitoring RPCs
-- ---------------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform public._assert_platform_admin();
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'users_24h', (select count(*) from auth.users where created_at > now() - interval '24 hours'),
    'active_24h', (select count(*) from auth.users where last_sign_in_at > now() - interval '24 hours'),
    'banned', (select count(*) from public.profiles where banned_until > now()),
    'auctions_by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.auctions group by status) s),
    'auctions_by_visibility', (select coalesce(jsonb_object_agg(visibility, n), '{}') from (select visibility, count(*) n from public.auctions group by visibility) s),
    'leagues', (select count(*) from public.auctions where mode = 'league'),
    'lots', (select count(*) from public.lots),
    'lots_sold', (select count(*) from public.lots where status = 'sold'),
    'sales_total', (select coalesce(sum(current_bid), 0) from public.lots l join public.auctions a on a.id = l.auction_id where l.status = 'sold' and a.mode = 'standard'),
    'bids', (select count(*) from public.bids),
    'bids_24h', (select count(*) from public.bids where created_at > now() - interval '24 hours'),
    'chat_24h', (select count(*) from public.chat_messages where created_at > now() - interval '24 hours'),
    'deal_messages', (select count(*) from public.deal_messages),
    'teams', (select count(*) from public.league_teams),
    'db_bytes', pg_database_size(current_database()),
    'db_limit_bytes', 500 * 1024 * 1024,
    'storage_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
    'storage_limit_bytes', 1024 * 1024 * 1024,
    'storage_by_bucket', (select coalesce(jsonb_object_agg(bucket_id, jsonb_build_object('files', n, 'bytes', b)), '{}')
                            from (select bucket_id, count(*) n, coalesce(sum((metadata ->> 'size')::bigint), 0) b from storage.objects group by bucket_id) s),
    'tables', (select coalesce(jsonb_agg(jsonb_build_object('table', relname, 'rows', n_live_tup, 'bytes', pg_total_relation_size(relid)) order by pg_total_relation_size(relid) desc), '[]')
                 from pg_catalog.pg_stat_user_tables where schemaname = 'public'),
    'cron', (select coalesce(jsonb_agg(x order by x ->> 'job'), '[]') from (
               select jsonb_build_object(
                 'job', j.jobname, 'schedule', j.schedule, 'active', j.active,
                 'last_run', (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid),
                 'last_status', (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
                 'failures_24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours'),
                 'last_error', (select d.return_message from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' order by d.start_time desc limit 1)
               ) x from cron.job j) s),
    'server_time', now()
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_users(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, email text, username text, display_name text, avatar_url text, provider text,
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
             u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null as email_confirmed, p.banned_until
        from auth.users u
        left join public.profiles p on p.id = u.id
       where p_search is null or p_search = ''
          or u.email ilike '%' || p_search || '%'
          or p.username ilike '%' || p_search || '%'
          or p.display_name ilike '%' || p_search || '%'
          or u.id::text = p_search
    )
    select b.id, b.email, b.username, b.display_name, b.avatar_url, b.provider,
           b.created_at, b.last_sign_in_at, b.email_confirmed, b.banned_until,
           exists (select 1 from public.platform_admins a where a.user_id = b.id),
           (select count(*) from public.auctions x where x.host_id = b.id),
           (select count(*) from public.bids x where x.bidder_id = b.id),
           (select count(*) from public.lots x where x.current_winner_id = b.id and x.status = 'sold'),
           coalesce((select c.share_contact from public.contact_settings c where c.user_id = b.id), false),
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
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'phone', u.phone, 'created_at', u.created_at,
                  'last_sign_in_at', u.last_sign_in_at, 'email_confirmed_at', u.email_confirmed_at,
                  'providers', u.raw_app_meta_data -> 'providers', 'metadata', u.raw_user_meta_data)
                  from auth.users u where u.id = p_user_id),
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
    'memberships', (select coalesce(jsonb_agg(m.auction_id), '[]') from public.auction_members m where m.user_id = p_user_id)
  );
end;
$$;

create or replace function public.admin_auctions(p_search text default null, p_status text default null, p_limit int default 50, p_offset int default 0)
returns table (
  id uuid, title text, status public.auction_status, mode text, visibility text, host_id uuid, host_name text, host_email text,
  created_at timestamptz, starts_at timestamptz, ends_at timestamptz, lots bigint, bids bigint, sold_total numeric,
  members bigint, invite_code text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_platform_admin();
  return query
    select a.id, a.title, a.status, a.mode, a.visibility, a.host_id, p.display_name, u.email::text,
           a.created_at, a.starts_at, a.ends_at,
           (select count(*) from public.lots l where l.auction_id = a.id),
           (select count(*) from public.bids b join public.lots l on l.id = b.lot_id where l.auction_id = a.id),
           (select coalesce(sum(l.current_bid), 0) from public.lots l where l.auction_id = a.id and l.status = 'sold'),
           (select count(*) from public.auction_members m where m.auction_id = a.id),
           (select s.invite_code from public.auction_secrets s where s.auction_id = a.id),
           count(*) over ()
      from public.auctions a
      join public.profiles p on p.id = a.host_id
      join auth.users u on u.id = a.host_id
     where (p_status is null or p_status = '' or a.status::text = p_status)
       and (p_search is null or p_search = '' or a.title ilike '%' || p_search || '%' or p.display_name ilike '%' || p_search || '%'
            or u.email ilike '%' || p_search || '%' or a.id::text = p_search)
     order by a.created_at desc
     limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
end;
$$;

-- Unified recent-activity feed across the platform.
create or replace function public.admin_activity(p_limit int default 100)
returns table (at timestamptz, kind text, actor_id uuid, actor text, summary text, auction_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_platform_admin();
  return query
    select * from (
      select u.created_at, 'signup'::text, u.id, coalesce(p.display_name, u.email::text), ('New account: ' || u.email)::text, null::uuid
        from auth.users u left join public.profiles p on p.id = u.id
      union all
      select b.created_at, 'bid', b.bidder_id, p.display_name,
             format('%s %s on "%s"', case when b.is_auto then 'Auto-bid' else 'Bid' end, b.amount, l.title), l.auction_id
        from public.bids b join public.lots l on l.id = b.lot_id join public.profiles p on p.id = b.bidder_id
      union all
      select c.created_at, 'chat', c.user_id, p.display_name, left(c.body, 200), c.auction_id
        from public.chat_messages c left join public.profiles p on p.id = c.user_id where c.kind = 'text'
      union all
      select d.created_at, 'deal', d.sender_id, p.display_name, format('[%s] %s', l.title, left(d.body, 180)), l.auction_id
        from public.deal_messages d join public.lots l on l.id = d.lot_id join public.profiles p on p.id = d.sender_id
      union all
      select a.created_at, 'auction', a.host_id, p.display_name, format('Created %s auction "%s" (%s)', a.visibility, a.title, a.mode), a.id
        from public.auctions a join public.profiles p on p.id = a.host_id
      union all
      select g.created_at, 'admin', g.admin_id, null::text, format('%s %s', g.action, coalesce(g.target, '')), null::uuid
        from public.admin_audit_log g
    ) feed
    order by 1 desc
    limit least(greatest(p_limit, 1), 500);
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation actions (audited)
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_ban(p_user_id uuid, p_until timestamptz, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._assert_platform_admin();
begin
  if p_user_id = me then
    raise exception 'You cannot ban yourself' using errcode = 'P0001';
  end if;
  update public.profiles set banned_until = p_until where id = p_user_id;
  insert into public.admin_audit_log (admin_id, action, target, details)
  values (me, case when p_until is null or p_until <= now() then 'unban' else 'ban' end, p_user_id::text,
          jsonb_build_object('until', p_until, 'reason', p_reason));
end;
$$;

create or replace function public.admin_cancel_auction(p_auction_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._assert_platform_admin();
begin
  update public.lots set status = 'withdrawn' where auction_id = p_auction_id and status in ('pending', 'open');
  update public.auctions set status = 'cancelled' where id = p_auction_id and status not in ('ended', 'cancelled');
  perform public._chat_system(p_auction_id, 'system', 'This auction was cancelled by the platform.');
  insert into public.admin_audit_log (admin_id, action, target, details)
  values (me, 'cancel_auction', p_auction_id::text, jsonb_build_object('reason', p_reason));
end;
$$;

create or replace function public.admin_delete_auction(p_auction_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._assert_platform_admin();
  t text;
begin
  select title into t from public.auctions where id = p_auction_id;
  delete from public.auctions where id = p_auction_id;
  insert into public.admin_audit_log (admin_id, action, target, details)
  values (me, 'delete_auction', p_auction_id::text, jsonb_build_object('title', t, 'reason', p_reason));
end;
$$;

create or replace function public.admin_remove_chat(p_message_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := public._assert_platform_admin();
begin
  update public.chat_messages set deleted_at = now(), pinned = false where id = p_message_id;
  insert into public.admin_audit_log (admin_id, action, target) values (me, 'remove_chat', p_message_id::text);
end;
$$;

revoke execute on function
  public._assert_platform_admin(),
  public.admin_overview(),
  public.admin_users(text, int, int),
  public.admin_user_detail(uuid),
  public.admin_auctions(text, text, int, int),
  public.admin_activity(int),
  public.admin_set_ban(uuid, timestamptz, text),
  public.admin_cancel_auction(uuid, text),
  public.admin_delete_auction(uuid, text),
  public.admin_remove_chat(bigint)
from public, anon;

grant execute on function
  public.admin_overview(),
  public.admin_users(text, int, int),
  public.admin_user_detail(uuid),
  public.admin_auctions(text, text, int, int),
  public.admin_activity(int),
  public.admin_set_ban(uuid, timestamptz, text),
  public.admin_cancel_auction(uuid, text),
  public.admin_delete_auction(uuid, text),
  public.admin_remove_chat(bigint)
to authenticated;
