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

function hslHex(h: number, sat: number, light: number): string {
  const a = (sat * Math.min(light, 1 - light)) / 1;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * One distinct colour per team the host allows: the curated set first, then
 * evenly spread hues (golden angle, alternating shade) for bigger leagues.
 */
export function teamPalette(maxTeams: number): string[] {
  const n = Math.max(2, Math.min(50, Math.floor(maxTeams) || 0));
  const out = TEAM_COLORS.slice(0, n);
  for (let i = 0; out.length < n; i++) {
    const c = hslHex((i * 137.508 + 20) % 360, 0.7, i % 2 ? 0.38 : 0.52);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Colours still free for a new team (case-insensitive). */
export function freeColors(maxTeams: number, taken: string[]): string[] {
  const used = new Set(taken.map((c) => c.toLowerCase()));
  return teamPalette(maxTeams).filter((c) => !used.has(c.toLowerCase()));
}
