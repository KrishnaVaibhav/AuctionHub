-- Co-hosts: a moderator can be given extra permissions on one auction.
--   can_edit  edit the auction, its lots, reserves and media
--   can_run   go live, pause, resume, end, close or withdraw lots, answer offers, run a league
-- Owner-only, always: moderators and co-hosts, cancel, delete, duplicate, next season.
-- Co-hosts with either permission cannot bid in that auction.

alter table public.auction_moderators
  add column can_edit boolean not null default false,
  add column can_run  boolean not null default false;

create or replace function public.auction_perm(p_auction_id uuid, p_perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_auction_host(p_auction_id)
      or exists (
        select 1 from public.auction_moderators m
         where m.auction_id = p_auction_id and m.user_id = (select auth.uid())
           and case p_perm when 'edit' then m.can_edit when 'run' then m.can_run else false end
      );
$$;
grant execute on function public.auction_perm(uuid, text) to anon, authenticated;

-- Host controls now accept co-hosts with can_run.
create or replace function public._assert_host(p_auction_id uuid)
returns public.auctions
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.auctions;
begin
  select * into a from public.auctions where id = p_auction_id for update;
  if a.id is null then
    raise exception 'Auction not found' using errcode = 'P0001';
  end if;
  if a.host_id is distinct from auth.uid()
     and not exists (select 1 from public.auction_moderators m
                      where m.auction_id = p_auction_id and m.user_id = auth.uid() and m.can_run) then
    raise exception 'Only the host can do this' using errcode = 'P0001';
  end if;
  return a;
end;
$$;

create or replace function public._assert_owner(p_auction_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.auctions a where a.id = p_auction_id and a.host_id = auth.uid()) then
    raise exception 'Only the host can do this' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public._assert_owner(uuid) from public, anon, authenticated;

-- Owner-only wrappers around the existing functions.
alter function public.add_moderator(uuid, text) rename to _add_moderator_core;
revoke execute on function public._add_moderator_core(uuid, text) from public, anon, authenticated;
create function public.add_moderator(p_auction_id uuid, p_username text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_owner(p_auction_id);
  return public._add_moderator_core(p_auction_id, p_username);
end;
$$;

alter function public.cancel_auction(uuid) rename to _cancel_auction_core;
revoke execute on function public._cancel_auction_core(uuid) from public, anon, authenticated;
create function public.cancel_auction(p_auction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_owner(p_auction_id);
  perform public._cancel_auction_core(p_auction_id);
end;
$$;

alter function public.delete_auction(uuid) rename to _delete_auction_core;
revoke execute on function public._delete_auction_core(uuid) from public, anon, authenticated;
create function public.delete_auction(p_auction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_owner(p_auction_id);
  perform public._delete_auction_core(p_auction_id);
end;
$$;

alter function public.duplicate_auction(uuid) rename to _duplicate_auction_core;
revoke execute on function public._duplicate_auction_core(uuid) from public, anon, authenticated;
create function public.duplicate_auction(p_auction_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_owner(p_auction_id);
  return public._duplicate_auction_core(p_auction_id);
end;
$$;

alter function public.league_next_season(uuid) rename to _league_next_season_core;
revoke execute on function public._league_next_season_core(uuid) from public, anon, authenticated;
create function public.league_next_season(p_auction_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform public._assert_owner(p_auction_id);
  return public._league_next_season_core(p_auction_id);
end;
$$;

revoke execute on function public.add_moderator(uuid, text), public.cancel_auction(uuid), public.delete_auction(uuid),
  public.duplicate_auction(uuid), public.league_next_season(uuid) from public, anon;
grant execute on function public.add_moderator(uuid, text), public.cancel_auction(uuid), public.delete_auction(uuid),
  public.duplicate_auction(uuid), public.league_next_season(uuid) to authenticated;

-- Only the owner sets permissions (moderators can still remove themselves).
drop policy "moderators host manage" on public.auction_moderators;
create policy "moderators owner manage" on public.auction_moderators for all to authenticated
  using (public.is_auction_host(auction_id)) with check (public.is_auction_host(auction_id));
create policy "moderators leave" on public.auction_moderators for delete to authenticated
  using (user_id = (select auth.uid()));

-- Editing: lots, auction fields, reserves and media.
create or replace function public.auction_editable(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.auctions a
     where a.id = p_auction_id
       and a.status in ('draft', 'scheduled')
       and public.auction_perm(a.id, 'edit')
  );
$$;

drop policy "auctions host update" on public.auctions;
create policy "auctions editors update" on public.auctions for update to authenticated
  using (public.auction_perm(id, 'edit')) with check (public.auction_perm(id, 'edit'));

drop policy "reserves host all" on public.lot_reserves;
create policy "reserves editors all" on public.lot_reserves for all to authenticated
  using (exists (select 1 from public.lots l where l.id = lot_id and public.auction_perm(l.auction_id, 'edit')))
  with check (exists (select 1 from public.lots l where l.id = lot_id and public.auction_editable(l.auction_id)));

drop policy "media host insert" on public.lot_media;
drop policy "media host delete" on public.lot_media;
create policy "media editors insert" on public.lot_media for insert to authenticated
  with check (exists (select 1 from public.lots l where l.id = lot_id and public.auction_perm(l.auction_id, 'edit')));
create policy "media editors delete" on public.lot_media for delete to authenticated
  using (exists (select 1 from public.lots l where l.id = lot_id and public.auction_perm(l.auction_id, 'edit')));

create or replace function public.storage_path_is_host(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  aid uuid;
begin
  begin
    aid := ((storage.foldername(p_name))[1])::uuid;
  exception when others then
    return false;
  end;
  return public.auction_perm(aid, 'edit');
end;
$$;

-- Co-hosts see drafts and private auctions.
create or replace function public.is_auction_cohost(p_auction_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.auction_moderators m
                  where m.auction_id = p_auction_id and m.user_id = (select auth.uid()) and (m.can_edit or m.can_run));
$$;
grant execute on function public.is_auction_cohost(uuid) to anon, authenticated;

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
         or public.is_auction_cohost(a.id)
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

drop policy "auctions readable" on public.auctions;
create policy "auctions readable" on public.auctions for select
  using (
    host_id = (select auth.uid())
    or public.is_auction_cohost(id)
    or (status <> 'draft' and (visibility <> 'private' or public.is_auction_member(id)))
    or public.is_platform_admin()
  );

-- Co-hosts can't bid, make sealed bids, set auto-bids or send offers in their auction.
create or replace function public.guard_cohost_bid()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.lots l
      join public.auction_moderators m on m.auction_id = l.auction_id
     where l.id = new.lot_id and m.user_id = new.bidder_id and (m.can_edit or m.can_run)
  ) then
    raise exception 'Co-hosts can''t bid in this auction' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_cohost_bid() from public, anon, authenticated;
create trigger bids_cohost_guard before insert on public.bids for each row execute function public.guard_cohost_bid();
create trigger sealed_cohost_guard before insert on public.sealed_bids for each row execute function public.guard_cohost_bid();
create trigger proxy_cohost_guard before insert on public.proxy_bids for each row execute function public.guard_cohost_bid();
create trigger offers_cohost_guard before insert on public.lot_offers for each row execute function public.guard_cohost_bid();

-- Co-hosted auctions for the host dashboard.
create or replace function public.my_cohosted_auctions()
returns setof public.auctions
language sql
stable
security definer
set search_path = ''
as $$
  select a.* from public.auctions a
    join public.auction_moderators m on m.auction_id = a.id
   where m.user_id = (select auth.uid()) and (m.can_edit or m.can_run)
   order by a.created_at desc;
$$;
revoke execute on function public.my_cohosted_auctions() from public, anon;
grant execute on function public.my_cohosted_auctions() to authenticated;
