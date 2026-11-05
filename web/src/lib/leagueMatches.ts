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

// ---------------------------------------------------------------------------
// Importing a stats sheet from a link (CSV, Google Sheets, or a JSON feed)
// ---------------------------------------------------------------------------

/**
 * Turns a shared link into one that returns raw data. A Google Sheets
 * "edit" or "view" link becomes its CSV export (same tab via gid).
 * Returns null for anything that is not an https URL.
 */
export function statsSourceUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const sheet = u.hostname === "docs.google.com" && u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
  if (sheet && !u.pathname.includes("/pub") && !u.pathname.endsWith("/export")) {
    const gid = u.searchParams.get("gid") ?? u.hash.match(/gid=(\d+)/)?.[1];
    return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  }
  return u.toString();
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * A JSON feed as a stats sheet: an array of player objects (or one wrapped in
 * "players", "data", "rows", "stats" or "results"). The player name comes from
 * "player", "name" or "title"; every numeric field becomes a stat column.
 */
export function jsonToSheet(json: unknown): string {
  let list: unknown = json;
  if (list && !Array.isArray(list) && typeof list === "object") {
    const o = list as Record<string, unknown>;
    list = o.players ?? o.data ?? o.rows ?? o.stats ?? o.results;
  }
  if (!Array.isArray(list)) throw new Error("Expected a list of players");
  const rows = list.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
  const nameKey = (r: Record<string, unknown>) => ["player", "name", "title", "Player", "Name"].find((k) => typeof r[k] === "string");
  const cols: string[] = [];
  for (const r of rows) {
    const nk = nameKey(r);
    for (const [k, v] of Object.entries(r)) {
      if (k === nk || cols.includes(k)) continue;
      if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))) cols.push(k);
    }
  }
  const lines = [["player", ...cols].map(csvCell).join(",")];
  for (const r of rows) {
    const nk = nameKey(r);
    if (!nk) continue;
    lines.push([r[nk], ...cols.map((c) => r[c])].map(csvCell).join(","));
  }
  return lines.join("\n");
}

/** Raw text from a fetched stats link: JSON feeds become CSV, CSV passes through. */
export function sheetFromResponse(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return jsonToSheet(JSON.parse(trimmed));
  if (/^\s*<(!doctype|html)/i.test(trimmed)) throw new Error("That link returned a web page, not data. Use a CSV or JSON link.");
  return trimmed;
}

/**
 * Fetches a stats link. Tries the browser first; most sites block that, so it
 * then asks our server (signed-in hosts only) to fetch it.
 */
export async function fetchStatsSheet(link: string, auctionId: string): Promise<string> {
  const url = statsSourceUrl(link);
  if (!url) throw new Error("Use an https link");
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (res.ok) return sheetFromResponse(await res.text());
  } catch {
    /* blocked by CORS: use the proxy */
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in first");
  const res = await fetch("/api/stats-fetch", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ url, auction_id: auctionId }),
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = body;
    try {
      msg = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {
      /* plain text */
    }
    throw new Error(msg || `Could not fetch (${res.status})`);
  }
  return sheetFromResponse(body);
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
