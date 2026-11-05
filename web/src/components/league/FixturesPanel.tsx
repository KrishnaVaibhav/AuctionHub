import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDotsIcon, MedalIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../../lib/supabase";
import { money } from "../../lib/format";
import type { LeagueMatch, PlayerStat, TeamScore } from "../../lib/leagueMatches";
import type { Auction, LeagueTeam, Lot } from "../../lib/types";
import { TeamChip } from "./TeamChip";

interface Fixture {
  id: string;
  week: number;
  starts_on: string;
  team_a: string;
  team_b: string | null;
}

/** Head-to-head result for one fixture: total team points across that week's matches. */
export function weekResult(f: Fixture, matches: LeagueMatch[], scores: TeamScore[]) {
  const ids = new Set(matches.filter((m) => m.week === f.week).map((m) => m.id));
  if (ids.size === 0 || !f.team_b) return null;
  const sum = (team: string) => scores.filter((s) => s.team_id === team && ids.has(s.match_id)).reduce((n, s) => n + Number(s.points), 0);
  return { a: sum(f.team_a), b: sum(f.team_b) };
}

/** Weekly head-to-head fixtures with W-L-D records, plus the host's generator. */
export function FixturesPanel({ auction, teams, matches, scores, isHost }: { auction: Auction; teams: LeagueTeam[]; matches: LeagueMatch[]; scores: TeamScore[]; isHost: boolean }) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [first, setFirst] = useState(new Date().toISOString().slice(0, 10));
  const [gap, setGap] = useState("7");
  const [msg, setMsg] = useState<string | null>(null);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  async function load() {
    const { data } = await supabase.from("league_fixtures").select("*").eq("auction_id", auction.id).order("week");
    setFixtures((data as Fixture[] | null) ?? []);
  }
  useEffect(() => {
    void load();
  }, [auction.id]);

  async function generate(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc("league_generate_fixtures", { p_auction_id: auction.id, p_first: first, p_days_between: Number(gap) });
    setMsg(error ? errorMessage(error) : `Created ${data} weeks of fixtures.`);
    await load();
  }

  const record = new Map<string, { w: number; l: number; d: number }>();
  for (const f of fixtures) {
    const r = weekResult(f, matches, scores);
    if (!r || !f.team_b) continue;
    const a = record.get(f.team_a) ?? { w: 0, l: 0, d: 0 };
    const b = record.get(f.team_b) ?? { w: 0, l: 0, d: 0 };
    if (r.a > r.b) (a.w++, b.l++);
    else if (r.b > r.a) (b.w++, a.l++);
    else (a.d++, b.d++);
    record.set(f.team_a, a);
    record.set(f.team_b, b);
  }
  const weeks = [...new Set(fixtures.map((f) => f.week))];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="space-y-3">
      <h3 className="section-title flex items-center gap-2 px-1">
        <CalendarDotsIcon size={20} weight="bold" aria-hidden="true" /> Head-to-head weeks
      </h3>
      {isHost && (
        <form onSubmit={generate} className="card flex flex-wrap items-end gap-3 p-4">
          <label>
            <span className="label">First week starts</span>
            <input type="date" className="input" value={first} onChange={(e) => setFirst(e.target.value)} />
          </label>
          <label>
            <span className="label">Days between weeks</span>
            <input type="number" min={1} max={60} className="input w-28" value={gap} onChange={(e) => setGap(e.target.value)} />
          </label>
          <button className="btn-primary">{fixtures.length ? "Regenerate fixtures" : "Generate fixtures"}</button>
          <p className="w-full text-xs text-stone-500">Every team plays every other team once. Matches you record join the week that has started by their date. Owners get a reminder the day before each week.</p>
          {msg && <p className="w-full text-sm text-stone-700">{msg}</p>}
        </form>
      )}

      {fixtures.length === 0 ? (
        <p className="card p-5 text-sm text-stone-500">No fixtures yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {[...teams]
              .sort((x, y) => (record.get(y.id)?.w ?? 0) - (record.get(x.id)?.w ?? 0))
              .map((tm) => {
                const r = record.get(tm.id) ?? { w: 0, l: 0, d: 0 };
                return (
                  <span key={tm.id} className="chip gap-2 bg-stone-900/[0.05] py-1.5 text-stone-700">
                    <TeamChip team={tm} />
                    <span className="tabular-nums">
                      {r.w}-{r.l}-{r.d}
                    </span>
                  </span>
                );
              })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {weeks.map((w) => {
              const list = fixtures.filter((f) => f.week === w);
              const current = list[0].starts_on <= today && (fixtures.find((f) => f.week === w + 1)?.starts_on ?? "9999") > today;
              return (
                <div key={w} className={`card space-y-2 p-4 ${current ? "ring-2 ring-brand-400" : ""}`}>
                  <p className="flex justify-between text-sm font-semibold">
                    Week {w}
                    <span className="font-normal text-stone-500">
                      {new Date(list[0].starts_on).toLocaleDateString()}
                      {current && <span className="chip ml-2 bg-brand-400 text-ink">Now</span>}
                    </span>
                  </p>
                  {list.map((f) => {
                    const a = teamById.get(f.team_a);
                    const b = f.team_b ? teamById.get(f.team_b) : undefined;
                    const r = weekResult(f, matches, scores);
                    return (
                      <div key={f.id} className="flex items-center gap-2 text-sm">
                        {a && <TeamChip team={a} />}
                        <span className={`tabular-nums ${r && r.a > r.b ? "font-extrabold" : "text-stone-500"}`}>{r ? r.a : ""}</span>
                        <span className="text-xs text-stone-400">vs</span>
                        <span className={`tabular-nums ${r && r.b > r.a ? "font-extrabold" : "text-stone-500"}`}>{r ? r.b : ""}</span>
                        {b ? <TeamChip team={b} /> : <span className="text-xs text-stone-500">bye</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/** Best buy, biggest flop and most traded player. */
export function SeasonAwards({ auction, lots, stats, teams }: { auction: Auction; lots: Lot[]; stats: PlayerStat[]; teams: LeagueTeam[] }) {
  const [trades, setTrades] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    void supabase
      .from("league_trades")
      .select("give_lots, get_lots")
      .eq("auction_id", auction.id)
      .eq("status", "accepted")
      .then(({ data }) => {
        const m = new Map<string, number>();
        for (const tr of (data as { give_lots: string[]; get_lots: string[] }[] | null) ?? []) for (const id of [...tr.give_lots, ...tr.get_lots]) m.set(id, (m.get(id) ?? 0) + 1);
        setTrades(m);
      });
  }, [auction.id]);

  const points = new Map<string, number>();
  for (const s of stats) points.set(s.lot_id, (points.get(s.lot_id) ?? 0) + Number(s.points));
  const sold = lots.filter((l) => l.status === "sold" && Number(l.current_bid) > 0);
  if (sold.length === 0 || points.size === 0) return null;
  const teamOf = (l: Lot) => teams.find((t) => t.id === l.winner_team_id);
  const best = [...sold].sort((a, b) => (points.get(b.id) ?? 0) / Number(b.current_bid) - (points.get(a.id) ?? 0) / Number(a.current_bid))[0];
  const flop = [...sold].sort((a, b) => Number(b.current_bid) - Number(a.current_bid)).slice(0, Math.max(3, Math.ceil(sold.length / 5))).sort((a, b) => (points.get(a.id) ?? 0) - (points.get(b.id) ?? 0))[0];
  const traded = [...trades.entries()].sort((a, b) => b[1] - a[1])[0];
  const tradedLot = traded ? lots.find((l) => l.id === traded[0]) : undefined;

  const award = (title: string, lot: Lot | undefined, line: string, tone: string) =>
    lot && (
      <div className="card flex items-center gap-3 p-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${tone}`}>
          <MedalIcon size={22} weight="fill" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">{title}</p>
          <p className="truncate font-semibold">
            {lot.title} {teamOf(lot) && <span className="text-xs text-stone-500">· {teamOf(lot)!.short_name}</span>}
          </p>
          <p className="text-xs text-stone-500">{line}</p>
        </div>
      </div>
    );

  return (
    <section className="space-y-2">
      <h3 className="section-title px-1">Season awards</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        {award("Best buy", best, `${points.get(best.id) ?? 0} pts for ${money(best.current_bid, auction.settings)}`, "bg-emerald-100 text-emerald-700")}
        {award("Biggest flop", flop, `${points.get(flop.id) ?? 0} pts for ${money(flop.current_bid, auction.settings)}`, "bg-red-100 text-red-700")}
        {award("Most traded", tradedLot, `${traded?.[1] ?? 0} trades`, "bg-sky-100 text-sky-700")}
      </div>
    </section>
  );
}
