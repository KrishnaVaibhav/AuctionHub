import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { CrownSimpleIcon, TrophyIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../../lib/supabase";
import { confirmDialog } from "../../lib/confirm";
import { fetchStatsSheet, formatScoring, parseScoring, parseStatsSheet, sheetFromResponse, teamTotals, useLeagueMatches } from "../../lib/leagueMatches";
import type { Auction, LeagueTeam, Lot } from "../../lib/types";
import { TeamChip } from "./TeamChip";
import { FixturesPanel, SeasonAwards } from "./FixturesPanel";

const SAMPLE = "player,runs,wickets,catches\nVirat Kohli,82,0,1\nJasprit Bumrah,4,3,0";

/** Fantasy scoring after the draft: captains, match stats, team scores and player totals. */
export function MatchesPanel({ auction, lots, teams, myTeam, isHost }: { auction: Auction; lots: Lot[]; teams: LeagueTeam[]; myTeam: LeagueTeam | null; isHost: boolean }) {
  const { matches, stats, scores, loading, reload } = useLeagueMatches(auction.id);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);
  const totals = teamTotals(scores);
  const league = auction.settings.league ?? {};
  const capX = league.captain_x ?? 2;
  const viceX = league.vice_x ?? 1.5;

  // Player totals across matches.
  const players = useMemo(() => {
    const m = new Map<string, { points: number; matches: number; stats: Record<string, number> }>();
    for (const s of stats) {
      const p = m.get(s.lot_id) ?? { points: 0, matches: 0, stats: {} };
      p.points += Number(s.points);
      p.matches += 1;
      for (const [k, v] of Object.entries(s.stats)) if (typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v))) p.stats[k] = (p.stats[k] ?? 0) + Number(v);
      m.set(s.lot_id, p);
    }
    return [...m.entries()].sort((a, b) => b[1].points - a[1].points);
  }, [stats]);
  const statKeys = [...new Set(players.flatMap(([, p]) => Object.keys(p.stats)))].slice(0, 5);

  return (
    <div className="animate-rise space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          Captains score <strong>{capX}x</strong>, vice-captains <strong>{viceX}x</strong>. Virtual points only.
        </p>
        <Link to={`/league/${auction.id}/season`} className="btn-ghost">
          <TrophyIcon size={16} aria-hidden="true" />
          Season table
        </Link>
      </div>

      {myTeam && <CaptainPicker team={myTeam} lots={lots} />}
      {isHost && <RecordMatch auction={auction} lots={lots} onDone={reload} />}

      <FixturesPanel auction={auction} teams={teams} matches={matches} scores={scores} isHost={isHost} />

      {loading ? (
        <div className="h-40 animate-pulse rounded-[22px] bg-stone-900/[0.05]" />
      ) : matches.length === 0 ? (
        <div className="card py-12 text-center text-sm text-stone-500">No matches recorded yet.</div>
      ) : (
        <>
          <section className="space-y-2">
            <h3 className="section-title px-1">Standings</h3>
            <div className="group-list">
              {[...teams]
                .sort((a, b) => (totals.get(b.id)?.points ?? 0) - (totals.get(a.id)?.points ?? 0))
                .map((t, i) => (
                  <div key={t.id} className="group-row">
                    <span className="w-6 text-center font-display font-extrabold text-stone-500 tabular-nums">{i + 1}</span>
                    <TeamChip team={t} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                    <span className="text-xs text-stone-500">{totals.get(t.id)?.matches ?? 0} matches</span>
                    <span className="w-20 text-right font-display text-lg font-extrabold tabular-nums">{totals.get(t.id)?.points ?? 0}</span>
                  </div>
                ))}
            </div>
          </section>

          <SeasonAwards auction={auction} lots={lots} stats={stats} teams={teams} />

          <section className="space-y-2">
            <h3 className="section-title px-1">Matches</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {[...matches].reverse().map((m) => {
                const ms = scores.filter((s) => s.match_id === m.id).sort((a, b) => b.points - a.points);
                const top = stats.filter((s) => s.match_id === m.id).sort((a, b) => b.points - a.points).slice(0, 3);
                return (
                  <div key={m.id} className="card space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{m.label}</p>
                        <p className="text-xs text-stone-500">{new Date(m.played_on).toLocaleDateString()}</p>
                      </div>
                      {isHost && (
                        <button
                          className="text-xs text-stone-500 hover:text-red-600"
                          onClick={async () => {
                            if (!(await confirmDialog({ title: `Delete "${m.label}"?`, body: "Its stats and team scores are removed.", confirmLabel: "Delete match", danger: true }))) return;
                            const { error } = await supabase.rpc("league_delete_match", { p_match_id: m.id });
                            if (!error) await reload();
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ms.map((s) => {
                        const t = teamById.get(s.team_id);
                        return t ? (
                          <span key={s.team_id} className="chip gap-1.5 bg-stone-900/[0.05] py-1 text-stone-700">
                            <TeamChip team={t} />
                            <span className="tabular-nums">{s.points}</span>
                          </span>
                        ) : null;
                      })}
                    </div>
                    <ul className="space-y-0.5 text-xs text-stone-600">
                      {top.map((s) => (
                        <li key={s.lot_id} className="flex justify-between gap-2">
                          <span className="truncate">{lotById.get(s.lot_id)?.title}</span>
                          <span className="font-semibold tabular-nums">{s.points} pts</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="section-title px-1">Player stats</h3>
            <div className="card overflow-x-auto">
              <table className="table w-full min-w-[32rem] text-sm">
                <thead className="text-left text-[11px] tracking-wider text-stone-500 uppercase">
                  <tr>
                    <th className="px-4 py-2.5">Player</th>
                    <th className="px-4 py-2.5">Team</th>
                    <th className="px-4 py-2.5 text-right">M</th>
                    {statKeys.map((k) => (
                      <th key={k} className="px-4 py-2.5 text-right">
                        {k}
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-right">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-900/[0.06]">
                  {players.map(([lotId, p]) => {
                    const l = lotById.get(lotId);
                    const t = l?.winner_team_id ? teamById.get(l.winner_team_id) : undefined;
                    return (
                      <tr key={lotId}>
                        <td className="px-4 py-2 font-medium">{l?.title}</td>
                        <td className="px-4 py-2">{t ? <TeamChip team={t} /> : <span className="text-stone-400">-</span>}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{p.matches}</td>
                        {statKeys.map((k) => (
                          <td key={k} className="px-4 py-2 text-right tabular-nums">
                            {p.stats[k] ?? 0}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-display font-extrabold tabular-nums">{p.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function CaptainPicker({ team, lots }: { team: LeagueTeam; lots: Lot[] }) {
  const squad = lots.filter((l) => l.winner_team_id === team.id && l.status === "sold");
  const [captain, setCaptain] = useState(team.captain_lot_id ?? "");
  const [vice, setVice] = useState(team.vice_lot_id ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("league_set_captain", { p_team_id: team.id, p_captain: captain || null, p_vice: vice || null });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: "Saved. Applies to matches recorded from now on." });
  }

  if (squad.length === 0) return null;
  return (
    <form onSubmit={save} className="glass flex flex-wrap items-end gap-3 rounded-[26px] p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
        <CrownSimpleIcon size={20} weight="fill" aria-hidden="true" />
      </span>
      <label className="min-w-40 flex-1">
        <span className="label">Captain</span>
        <select className="input" value={captain} onChange={(e) => setCaptain(e.target.value)}>
          <option value="">None</option>
          {squad.map((l) => (
            <option key={l.id} value={l.id} disabled={l.id === vice}>
              {l.title}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-40 flex-1">
        <span className="label">Vice-captain</span>
        <select className="input" value={vice} onChange={(e) => setVice(e.target.value)}>
          <option value="">None</option>
          {squad.map((l) => (
            <option key={l.id} value={l.id} disabled={l.id === captain}>
              {l.title}
            </option>
          ))}
        </select>
      </label>
      <button className="btn-primary">Save captains</button>
      {msg && <p className={`w-full text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </form>
  );
}

function RecordMatch({ auction, lots, onDone }: { auction: Auction; lots: Lot[]; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sheet, setSheet] = useState("");
  const [rules, setRules] = useState(formatScoring(auction.settings.league?.scoring) || "runs: 1, wickets: 25, catches: 8");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseStatsSheet(sheet, lots), [sheet, lots]);
  const savedLink = auction.settings.league?.stats_url ?? "";
  const [link, setLink] = useState(savedLink);
  const [fetching, setFetching] = useState(false);

  async function loadLink() {
    setFetching(true);
    setMsg(null);
    try {
      setSheet(await fetchStatsSheet(link, auction.id));
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    setFetching(false);
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) return setMsg({ ok: false, text: "That file is over 1 MB" });
    try {
      setSheet(sheetFromResponse(await file.text()));
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    // Save scoring rules first if they changed (needs edit permission).
    // The stats link is remembered for next time.
    const scoring = parseScoring(rules);
    const statsUrl = link.trim();
    if (formatScoring(scoring) !== formatScoring(auction.settings.league?.scoring) || statsUrl !== savedLink) {
      const settings = { ...auction.settings, league: { ...auction.settings.league, scoring, stats_url: statsUrl || undefined } };
      const { error } = await supabase.from("auctions").update({ settings }).eq("id", auction.id);
      if (error) {
        setBusy(false);
        return setMsg({ ok: false, text: errorMessage(error) });
      }
    }
    const { error } = await supabase.rpc("league_record_match", { p_auction_id: auction.id, p_label: label, p_played_on: date, p_rows: parsed.rows });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    setMsg({ ok: true, text: `Recorded ${parsed.rows.length} players.` });
    setLabel("");
    setSheet("");
    await onDone();
  }

  if (!open)
    return (
      <button className="btn-accent" onClick={() => setOpen(true)}>
        Record a match
      </button>
    );

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h3 className="section-title text-base">Record a match</h3>
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <label>
          <span className="label">Match</span>
          <input className="input" required maxLength={80} placeholder="Match 1 · RR vs BB" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label>
          <span className="label">Played on</span>
          <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="label">Scoring (points per stat)</span>
        <input className="input font-mono text-xs" value={rules} onChange={(e) => setRules(e.target.value)} />
      </label>
      <div>
        <span className="label">Stats link (CSV, Google Sheet or JSON feed)</span>
        <div className="flex flex-wrap gap-2">
          <input
            type="url"
            className="input min-w-0 flex-1 font-mono text-xs"
            placeholder="https://docs.google.com/spreadsheets/d/..."
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button type="button" className="btn-ghost" disabled={fetching || !link.trim()} onClick={() => void loadLink()}>
            {fetching ? "Fetching..." : "Fetch"}
          </button>
          <label className="btn-ghost cursor-pointer">
            Upload file
            <input type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json" className="sr-only" onChange={(e) => void loadFile(e.target.files?.[0])} />
          </label>
        </div>
        <span className="mt-1 block text-xs text-stone-500">
          A Google Sheet must be shared as "Anyone with the link". The link is saved, so next match is one tap.
        </span>
      </div>
      <label className="block">
        <span className="label">Stats sheet</span>
        <textarea
          className="input min-h-36 font-mono text-xs"
          placeholder={SAMPLE}
          value={sheet}
          onChange={(e) => setSheet(e.target.value)}
        />
        <span className="mt-1 block text-xs text-stone-500">
          Paste from a spreadsheet or scorecard export: player first, then one column per stat. Add a "points" column to set points directly.
        </span>
      </label>
      {sheet.trim() && (
        <p className="text-sm">
          <strong>{parsed.rows.length}</strong> players matched
          {parsed.unmatched.length > 0 && <span className="text-red-600"> · not found: {parsed.unmatched.slice(0, 6).join(", ")}{parsed.unmatched.length > 6 ? "..." : ""}</span>}
        </p>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || parsed.rows.length === 0}>
          Save match
        </button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </form>
  );
}
