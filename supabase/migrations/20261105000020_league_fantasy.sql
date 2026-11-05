-- League fantasy scoring: match stats per player, captain and vice-captain
-- multipliers, team scores per match, and a public table across seasons.
--
-- Settings (auctions.settings -> league):
--   scoring: {"runs": 1, "wickets": 25, ...}   points per unit of each stat
--   captain_x: 2, vice_x: 1.5                   multipliers

-- ---------------------------------------------------------------------------
-- Seasons belong to a series; teams carry a franchise id across seasons.
-- ---------------------------------------------------------------------------
alter table public.auctions add column series_id uuid;
update public.auctions set series_id = id where mode = 'league' and series_id is null;

alter table public.league_teams
  add column franchise_id   uuid,
  add column captain_lot_id uuid references public.lots (id) on delete set null,
  add column vice_lot_id    uuid references public.lots (id) on delete set null;
update public.league_teams set franchise_id = id where franchise_id is null;

create or replace function public.default_series_ids()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'auctions' then
    if new.mode = 'league' and new.series_id is null then
      new.series_id := new.id;
    end if;
  else
    new.franchise_id := coalesce(new.franchise_id, new.id);
  end if;
  return new;
end;
$$;
create trigger auctions_series before insert or update of mode on public.auctions
  for each row execute function public.default_series_ids();
create trigger teams_franchise before insert on public.league_teams
  for each row execute function public.default_series_ids();

-- Next season joins the series and keeps each team's franchise.
create or replace function public.league_next_season(p_auction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  perform public._assert_owner(p_auction_id);
  new_id := public._league_next_season_core(p_auction_id);
  update public.auctions n
     set series_id = coalesce(o.series_id, o.id)
    from public.auctions o
   where o.id = p_auction_id and n.id = new_id;
  update public.league_teams n
     set franchise_id = coalesce(o.franchise_id, o.id)
    from public.league_teams o
   where o.auction_id = p_auction_id and n.id = md5(o.id::text || new_id::text)::uuid;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Matches, player stats and team scores (read-only to clients; written by RPC)
-- ---------------------------------------------------------------------------
create table public.league_matches (
  id          uuid primary key default gen_random_uuid(),
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 80),
  played_on   date not null default current_date,
  created_at  timestamptz not null default now()
);
create index league_matches_auction_idx on public.league_matches (auction_id, played_on);

create table public.league_player_stats (
  match_id  uuid not null references public.league_matches (id) on delete cascade,
  lot_id    uuid not null references public.lots (id) on delete cascade,
  stats     jsonb not null default '{}' check (jsonb_typeof(stats) = 'object'),
  points    numeric(10, 2) not null default 0,
  primary key (match_id, lot_id)
);
create index league_player_stats_lot_idx on public.league_player_stats (lot_id);

create table public.league_team_scores (
  match_id        uuid not null references public.league_matches (id) on delete cascade,
  team_id         uuid not null references public.league_teams (id) on delete cascade,
  points          numeric(12, 2) not null,
  captain_lot_id  uuid,
  vice_lot_id     uuid,
  primary key (match_id, team_id)
);

alter table public.league_matches enable row level security;
alter table public.league_player_stats enable row level security;
alter table public.league_team_scores enable row level security;
revoke all on public.league_matches, public.league_player_stats, public.league_team_scores from anon, authenticated;
grant select on public.league_matches, public.league_player_stats, public.league_team_scores to anon, authenticated;
create policy "matches readable" on public.league_matches for select using (public.auction_visible(auction_id));
create policy "player stats readable" on public.league_player_stats for select
  using (exists (select 1 from public.league_matches m where m.id = match_id and public.auction_visible(m.auction_id)));
create policy "team scores readable" on public.league_team_scores for select
  using (exists (select 1 from public.league_matches m where m.id = match_id and public.auction_visible(m.auction_id)));
alter publication supabase_realtime add table public.league_matches;

-- Points for one player's stat line under the league's scoring rules.
create or replace function public._stat_points(p_stats jsonb, p_rules jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum((s.value)::numeric * (r.value)::numeric), 0)
    from jsonb_each_text(p_stats) s
    join jsonb_each_text(coalesce(p_rules, '{}')) r on lower(r.key) = lower(s.key)
   where s.value ~ '^-?[0-9]+(\.[0-9]+)?$' and r.value ~ '^-?[0-9]+(\.[0-9]+)?$';
$$;

-- lots.points mirrors the player's total across recorded matches.
create or replace function public._refresh_lot_points(p_lots uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.lots l
     set points = (select sum(s.points) from public.league_player_stats s where s.lot_id = l.id)
   where l.id = any (p_lots);
$$;
revoke execute on function public._refresh_lot_points(uuid[]) from public, anon, authenticated;

-- Record a match: p_rows = [{"lot_id": uuid, "stats": {...}, "points": optional override}, ...]
create or replace function public.league_record_match(p_auction_id uuid, p_label text, p_played_on date, p_rows jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a       public.auctions := public._assert_host(p_auction_id);
  rules   jsonb := a.settings -> 'league' -> 'scoring';
  cap_x   numeric := public.league_setting(a.settings, 'captain_x', 2);
  vice_x  numeric := public.league_setting(a.settings, 'vice_x', 1.5);
  mid     uuid;
  touched uuid[];
begin
  if a.mode <> 'league' or a.status in ('draft', 'scheduled', 'cancelled') then
    raise exception 'Record matches after the draft has started' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Add at least one player' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'Up to 200 players per match' using errcode = 'P0001';
  end if;

  insert into public.league_matches (auction_id, label, played_on)
  values (p_auction_id, btrim(p_label), coalesce(p_played_on, current_date))
  returning id into mid;

  insert into public.league_player_stats (match_id, lot_id, stats, points)
  select mid, l.id, coalesce(r -> 'stats', '{}'),
         coalesce((r ->> 'points')::numeric, public._stat_points(coalesce(r -> 'stats', '{}'), rules))
    from jsonb_array_elements(p_rows) r
    join public.lots l on l.id = (r ->> 'lot_id')::uuid and l.auction_id = p_auction_id
  on conflict (match_id, lot_id) do nothing;

  if not exists (select 1 from public.league_player_stats where match_id = mid) then
    raise exception 'None of those players are in this league' using errcode = 'P0001';
  end if;

  -- Team score: each squad player's points, with the captain and vice-captain multiplied.
  insert into public.league_team_scores (match_id, team_id, points, captain_lot_id, vice_lot_id)
  select mid, t.id,
         coalesce(sum(s.points * case when s.lot_id = t.captain_lot_id then cap_x
                                      when s.lot_id = t.vice_lot_id then vice_x else 1 end), 0),
         t.captain_lot_id, t.vice_lot_id
    from public.league_teams t
    left join public.lots l on l.winner_team_id = t.id and l.status = 'sold'
    left join public.league_player_stats s on s.match_id = mid and s.lot_id = l.id
   where t.auction_id = p_auction_id
   group by t.id;

  select array_agg(lot_id) into touched from public.league_player_stats where match_id = mid;
  perform public._refresh_lot_points(touched);
  return mid;
end;
$$;

create or replace function public.league_delete_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m       public.league_matches;
  touched uuid[];
begin
  select * into m from public.league_matches where id = p_match_id;
  if m.id is null then
    raise exception 'Match not found' using errcode = 'P0001';
  end if;
  perform public._assert_host(m.auction_id);
  select array_agg(lot_id) into touched from public.league_player_stats where match_id = p_match_id;
  delete from public.league_matches where id = p_match_id;
  perform public._refresh_lot_points(coalesce(touched, '{}'));
end;
$$;

-- Team owners pick a captain and vice-captain from their own squad.
create or replace function public.league_set_captain(p_team_id uuid, p_captain uuid, p_vice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.league_teams;
begin
  select * into t from public.league_teams where id = p_team_id for update;
  if t.id is null or t.owner_id is distinct from auth.uid() then
    raise exception 'Only the team owner can pick captains' using errcode = 'P0001';
  end if;
  if p_captain is not null and p_captain = p_vice then
    raise exception 'Pick two different players' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(array[p_captain, p_vice]) x(id)
     where x.id is not null
       and not exists (select 1 from public.lots l where l.id = x.id and l.winner_team_id = t.id and l.status = 'sold')
  ) then
    raise exception 'Captains must be in your squad' using errcode = 'P0001';
  end if;
  update public.league_teams set captain_lot_id = p_captain, vice_lot_id = p_vice where id = t.id;
end;
$$;

revoke execute on function public.league_record_match(uuid, text, date, jsonb), public.league_delete_match(uuid),
  public.league_set_captain(uuid, uuid, uuid) from public, anon;
grant execute on function public.league_record_match(uuid, text, date, jsonb), public.league_delete_match(uuid),
  public.league_set_captain(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Public season table: every season in the series, ranked by franchise.
-- A season with no recorded matches falls back to the host's player points.
-- ---------------------------------------------------------------------------
create or replace function public.league_season_table(p_auction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  if not public.auction_visible(p_auction_id) then
    raise exception 'League not found' using errcode = 'P0001';
  end if;
  select coalesce(series_id, id) into sid from public.auctions where id = p_auction_id and mode = 'league';
  if sid is null then
    raise exception 'League not found' using errcode = 'P0001';
  end if;

  return (
    with seasons as (
      select a.id, a.title, a.status, coalesce((a.settings -> 'league' ->> 'season')::int, 1) as season
        from public.auctions a
       where coalesce(a.series_id, a.id) = sid and a.mode = 'league' and a.status <> 'draft'
         and public.auction_visible(a.id)
    ), team_season as (
      select t.franchise_id, t.id as team_id, t.name, t.short_name, t.color, s.id as auction_id, s.season,
             case when exists (select 1 from public.league_matches m where m.auction_id = s.id)
                  then (select coalesce(sum(ts.points), 0) from public.league_team_scores ts where ts.team_id = t.id)
                  else (select coalesce(sum(l.points), 0) from public.lots l where l.winner_team_id = t.id and l.status = 'sold')
             end as points,
             (select count(*) from public.league_team_scores ts where ts.team_id = t.id) as matches
        from public.league_teams t
        join seasons s on s.id = t.auction_id
    ), franchises as (
      select franchise_id,
             (array_agg(name order by season desc))[1] as name,
             (array_agg(short_name order by season desc))[1] as short_name,
             (array_agg(color order by season desc))[1] as color,
             sum(points) as total,
             sum(matches) as matches,
             jsonb_object_agg(auction_id, points) as by_season
        from team_season
       group by franchise_id
    ), players as (
      select l.title, sum(ps.points) as points,
             (array_agg(t.short_name order by m.played_on desc))[1] as team
        from public.league_player_stats ps
        join public.league_matches m on m.id = ps.match_id
        join seasons s on s.id = m.auction_id
        join public.lots l on l.id = ps.lot_id
        left join public.league_teams t on t.id = l.winner_team_id
       group by l.title
       order by sum(ps.points) desc
       limit 10
    )
    select jsonb_build_object(
      'seasons', coalesce((select jsonb_agg(jsonb_build_object('auction_id', id, 'title', title, 'status', status, 'season', season) order by season) from seasons), '[]'),
      'teams', coalesce((select jsonb_agg(jsonb_build_object('franchise_id', franchise_id, 'name', name, 'short_name', short_name,
                         'color', color, 'total', total, 'matches', matches, 'by_season', by_season) order by total desc, name) from franchises), '[]'),
      'players', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'points', points, 'team', team)) from players), '[]')
    )
  );
end;
$$;
grant execute on function public.league_season_table(uuid) to anon, authenticated;
