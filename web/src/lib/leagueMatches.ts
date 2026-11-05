import { useCallback, useEffect, useState } from "react";
import { supabase, channelName } from "./supabase";
import { parseCsv } from "./csv";

export interface LeagueMatch {
  id: string;
  auction_id: string;
  label: string;
  played_on: string;
  week: number | null;
  created_at: string;
}
export interface PlayerStat {
  match_id: string;
  lot_id: string;
  stats: Record<string, number | string>;
  points: number;
}
export interface TeamScore {
  match_id: string;
  team_id: string;
  points: number;
  captain_lot_id: string | null;
  vice_lot_id: string | null;
}

export interface StatRow {
  lot_id: string;
  stats: Record<string, number>;
  points?: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Reads a pasted stats sheet: the first column is the player, other columns
 * are stats ("runs", "wickets"...). An optional "points" column overrides the
 * league's scoring for that row. Players match lot titles, ignoring case and
 * punctuation; a unique first or last name also counts ("Kohli" or "Virat" -> "Virat Kohli").
 */
export function parseStatsSheet(text: string, players: { id: string; title: string }[]) {
  // Spreadsheet pastes are tab-separated.
  const csv = text.includes("	") && !text.includes(",") ? text.replace(/	/g, ",") : text;
  const table = parseCsv(csv.trim()).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length < 2) return { rows: [] as StatRow[], unmatched: [] as string[], columns: [] as string[] };
  const header = table[0].map((h) => norm(h));
  const columns = header.slice(1).filter(Boolean);
  const byName = new Map(players.map((p) => [norm(p.title), p.id]));
  const rows: StatRow[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  for (const r of table.slice(1)) {
    const name = norm(r[0] ?? "");
    if (!name) continue;
    let id = byName.get(name);
    if (!id) {
      const hits = players.filter((p) => norm(p.title).startsWith(name + " ") || norm(p.title).endsWith(" " + name));
      if (hits.length === 1) id = hits[0].id;
    }
    if (!id || seen.has(id)) {
      if (!id) unmatched.push(r[0].trim());
      continue;
    }
    seen.add(id);
    const stats: Record<string, number> = {};
    let points: number | undefined;
    header.forEach((h, i) => {
      if (i === 0 || !h) return;
      const v = Number(String(r[i] ?? "").trim());
      if (String(r[i] ?? "").trim() === "" || !Number.isFinite(v)) return;
      if (h === "points" || h === "pts") points = v;
      else stats[h] = v;
    });
    rows.push(points === undefined ? { lot_id: id, stats } : { lot_id: id, stats, points });
  }
  return { rows, unmatched, columns };
}

/** "runs: 1, wickets: 25" <-> {runs: 1, wickets: 25} */
export function parseScoring(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of text.split(/[,\n]/)) {
    const m = part.match(/^\s*([^:=]+?)\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) out[norm(m[1])] = Number(m[2]);
  }
  return out;
}
export const formatScoring = (rules: Record<string, number> | undefined) =>
  Object.entries(rules ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

/** Total points per team across matches. */
export function teamTotals(scores: TeamScore[]): Map<string, { points: number; matches: number }> {
  const out = new Map<string, { points: number; matches: number }>();
  for (const s of scores) {
    const t = out.get(s.team_id) ?? { points: 0, matches: 0 };
    out.set(s.team_id, { points: t.points + Number(s.points), matches: t.matches + 1 });
  }
  return out;
}

export function useLeagueMatches(auctionId: string) {
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [stats, setStats] = useState<PlayerStat[]>([]);
  const [scores, setScores] = useState<TeamScore[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data: m } = await supabase.from("league_matches").select("*").eq("auction_id", auctionId).order("played_on").order("created_at");
    const list = (m as LeagueMatch[] | null) ?? [];
    setMatches(list);
    if (list.length) {
      const ids = list.map((x) => x.id);
      const [s, t] = await Promise.all([
        supabase.from("league_player_stats").select("*").in("match_id", ids),
        supabase.from("league_team_scores").select("*").in("match_id", ids),
      ]);
      setStats((s.data as PlayerStat[] | null) ?? []);
      setScores((t.data as TeamScore[] | null) ?? []);
    } else {
      setStats([]);
      setScores([]);
    }
    setLoading(false);
  }, [auctionId]);

  useEffect(() => {
    void reload();
    const channel = supabase
      .channel(channelName(`matches:${auctionId}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "league_matches", filter: `auction_id=eq.${auctionId}` }, () => void reload())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [auctionId, reload]);

  return { matches, stats, scores, loading, reload };
}
