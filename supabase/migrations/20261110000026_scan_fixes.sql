-- Small fixes from the app-wide bug scan.
-- 1. Changing a price guess paid the "guess" XP again each time (up to the
--    daily cap). XP is now paid for the first guess on a lot only.
-- 2. Two people joining a watch party at once could push it past 20 members.
--    Joining now locks the party row while it counts.

create or replace function public.make_prediction(p_lot_id uuid, p_kind text, p_amount numeric, p_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l  public.lots;
  a  public.auctions;
  n  int;
begin
  if auth.uid() is null then raise exception 'Sign in to play' using errcode = 'P0001'; end if;
  select * into l from public.lots where id = p_lot_id;
  if l.id is null or not public.auction_visible(l.auction_id) then raise exception 'Lot not found' using errcode = 'P0001'; end if;
  select * into a from public.auctions where id = l.auction_id;
  if a.host_id = auth.uid() or public.is_auction_cohost(a.id) then
    raise exception 'Hosts can''t play in their own auction' using errcode = 'P0001';
  end if;
  if not public._fun_on(a.settings, case when p_kind = 'team' then 'pickem' else 'guesses' end) then
    raise exception 'The host has turned this game off' using errcode = 'P0001';
  end if;
  if l.status not in ('pending', 'open') or l.bid_count > 0 or l.current_bid is not null then
    raise exception 'Guesses lock once bidding starts' using errcode = 'P0001';
  end if;
  if p_kind = 'team' then
    if a.mode <> 'league' or not exists (select 1 from public.league_teams t where t.id = p_team_id and t.auction_id = a.id) then
      raise exception 'Pick a team in this league' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.league_teams t where t.auction_id = a.id and t.owner_id = auth.uid()) then
      raise exception 'Team owners can''t play pick''em' using errcode = 'P0001';
    end if;
  elsif p_kind = 'price' then
    if p_amount is null or p_amount <= 0 or p_amount > 1e10 then raise exception 'Enter a price' using errcode = 'P0001'; end if;
  else
    raise exception 'Unknown game' using errcode = 'P0001';
  end if;

  -- XP for the first guess on this lot only, not for every change.
  select count(*) into n from public.predictions p where p.lot_id = p_lot_id and p.user_id = auth.uid() and p.kind = p_kind;

  insert into public.predictions (lot_id, user_id, kind, amount, team_id)
  values (p_lot_id, auth.uid(), p_kind, case when p_kind = 'price' then round(p_amount, 2) end, case when p_kind = 'team' then p_team_id end)
  on conflict (lot_id, user_id, kind) do update set amount = excluded.amount, team_id = excluded.team_id, created_at = now();
  if n = 0 then
    perform public._grant_xp(auth.uid(), 'guess', 5, 50);
  end if;
end;
$$;

create or replace function public.join_watch_party(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  wp public.watch_parties;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = 'P0001'; end if;
  select * into wp from public.watch_parties where code = lower(btrim(p_code)) for update;
  if wp.id is null or not public.auction_visible(wp.auction_id) then raise exception 'Party not found' using errcode = 'P0001'; end if;
  if (select count(*) from public.watch_party_members where party_id = wp.id) >= 20 then
    raise exception 'This party is full' using errcode = 'P0001';
  end if;
  insert into public.watch_party_members (party_id, user_id) values (wp.id, auth.uid()) on conflict do nothing;
  return wp.id;
end;
$$;
