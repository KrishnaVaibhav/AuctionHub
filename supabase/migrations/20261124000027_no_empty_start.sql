-- A scheduled auction with no lots started on time, went live empty, and the
-- scheduler ended it a minute later. Now it waits in "scheduled" until the
-- host adds a lot (start_auction already refuses a manual start without lots).

create or replace function public._start_auction(p_auction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a         public.auctions;
  base_end  timestamptz;
  stagger   int;
  first_id  uuid;
begin
  select * into a from public.auctions where id = p_auction_id for no key update;
  if a.id is null or a.status not in ('draft', 'scheduled') then
    return;
  end if;
  -- Nothing to sell: stay as is. The scheduler would otherwise start an empty
  -- auction and end it a minute later; it starts once the host adds a lot.
  if not exists (select 1 from public.lots where auction_id = p_auction_id and status = 'pending') then
    return;
  end if;

  if a.mode = 'league' then
    select id into first_id from public.lots
     where auction_id = p_auction_id and status = 'pending'
     order by position, created_at limit 1;
    update public.lots
       set status = 'open', opens_at = now(),
           ends_at = now() + make_interval(secs => public.league_setting(a.settings, 'lot_seconds', 30)::int)
     where id = first_id;
    update public.auctions
       set status = 'live', starts_at = least(coalesce(starts_at, now()), now()), ends_at = null
     where id = p_auction_id;
    perform public._chat_system(p_auction_id, 'system', 'The league auction is live. First player is on the block!');
    return;
  end if;

  stagger := greatest(coalesce((a.settings ->> 'lot_stagger_seconds')::int, 0), 0);
  base_end := case
                when a.ends_at is not null and a.ends_at > now() + interval '1 minute' then a.ends_at
                else now() + make_interval(mins => greatest(coalesce((a.settings ->> 'lot_duration_minutes')::int, 10), 1))
              end;

  update public.lots l
     set status = 'open',
         opens_at = now(),
         ends_at = base_end + make_interval(secs => stagger * (r.rn - 1))
    from (
      select id, row_number() over (order by position, created_at) as rn
      from public.lots where auction_id = p_auction_id and status = 'pending'
    ) r
   where l.id = r.id;

  update public.auctions
     set status = 'live',
         starts_at = least(coalesce(starts_at, now()), now()),
         ends_at = (select max(ends_at) from public.lots where auction_id = p_auction_id)
   where id = p_auction_id;

  perform public._chat_system(p_auction_id, 'system', 'The auction is live. Good luck!');
end;
$$;
