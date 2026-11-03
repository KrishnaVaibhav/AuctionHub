-- In-app support/contact form (replaces any public personal contact details).
-- Anyone can submit; only platform admins can read and resolve.

create table public.support_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users (id) on delete set null,
  category    text not null check (category in ('question', 'abuse', 'data', 'bug', 'other')),
  message     text not null check (char_length(btrim(message)) between 10 and 2000),
  contact     text check (contact is null or char_length(contact) <= 200),  -- optional, only if the sender wants a reply elsewhere
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now()
);
create index support_requests_status_idx on public.support_requests (status, created_at desc);

alter table public.support_requests enable row level security;
revoke all on public.support_requests from anon, authenticated;
grant insert (user_id, category, message, contact) on public.support_requests to anon, authenticated;
grant select, update (status) on public.support_requests to authenticated;

create policy "anyone submits" on public.support_requests for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
create policy "admin reads support" on public.support_requests for select to authenticated
  using (public.is_platform_admin());
create policy "admin resolves support" on public.support_requests for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Spam guard: 5 requests per hour per signed-in user, 50 per hour from anonymous visitors overall.
create or replace function public.support_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    if (select count(*) from public.support_requests where user_id = new.user_id and created_at > now() - interval '1 hour') >= 5 then
      raise exception 'Too many requests. Please try again later.' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.support_requests where user_id is null and created_at > now() - interval '1 hour') >= 50 then
    raise exception 'Too many requests. Please try again later.' using errcode = 'P0001';
  end if;
  new.message := btrim(new.message);
  return new;
end;
$$;
create trigger support_rate_limit before insert on public.support_requests
  for each row execute function public.support_rate_limit();
revoke execute on function public.support_rate_limit() from public, anon, authenticated;

-- Admin list with the sender's account (if signed in).
create or replace function public.admin_support(p_status text default 'open')
returns table (id bigint, created_at timestamptz, category text, message text, contact text, status text,
               user_id uuid, user_name text, user_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public._assert_platform_admin();
  return query
    select s.id, s.created_at, s.category, s.message, s.contact, s.status, s.user_id, p.display_name, u.email::text
      from public.support_requests s
      left join public.profiles p on p.id = s.user_id
      left join auth.users u on u.id = s.user_id
     where p_status is null or p_status = '' or s.status = p_status
     order by s.created_at desc
     limit 500;
end;
$$;
revoke execute on function public.admin_support(text) from public, anon;
grant execute on function public.admin_support(text) to authenticated;

-- Retention: resolved requests are removed after 180 days.
select cron.schedule('cleanup-support', '27 3 * * *',
  $$delete from public.support_requests where status = 'resolved' and created_at < now() - interval '180 days'$$);
