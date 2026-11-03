import { useCallback, useEffect, useState } from "react";
import { supabase, channelName } from "./supabase";
import type { LeagueTeam } from "./types";

/** League teams for an auction, kept live via Realtime (purse changes, joins, leaves). */
export function useLeagueTeams(auctionId: string | undefined, enabled: boolean) {
  const [teams, setTeams] = useState<LeagueTeam[]>([]);

  const reload = useCallback(async () => {
    if (!auctionId || !enabled) return;
    const { data } = await supabase.from("league_teams").select("*").eq("auction_id", auctionId).order("created_at");
    setTeams((data as LeagueTeam[] | null) ?? []);
  }, [auctionId, enabled]);

  useEffect(() => {
    if (!auctionId || !enabled) return;
    const channel = supabase
      .channel(channelName(`teams:${auctionId}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "league_teams", filter: `auction_id=eq.${auctionId}` }, () => void reload())
      .subscribe((s) => s === "SUBSCRIBED" && void reload());
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [auctionId, enabled, reload]);

  return { teams, reload };
}

export const LEAGUE_DEFAULTS = {
  purse: 1_000_000_000,
  squad_min: 0,
  squad_max: 15,
  max_teams: 10,
  lot_seconds: 30,
  bid_seconds: 15,
  break_seconds: 5,
  min_base: 0,
  host_can_play: false,
};

export const LEAGUE_INCREMENTS: [number, number][] = [
  [0, 500_000],
  [10_000_000, 2_500_000],
  [50_000_000, 5_000_000],
  [200_000_000, 10_000_000],
];

export const TEAM_COLORS = ["#f59e0b", "#ef4444", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#facc15", "#1e293b"];
