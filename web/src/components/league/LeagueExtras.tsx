import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { supabase, errorMessage, channelName } from "../../lib/supabase";
import { money, remaining } from "../../lib/format";
import { useServerNow } from "../../lib/clock";
import { confirmDialog } from "../../lib/confirm";
import type { Auction, LeagueTeam, Lot } from "../../lib/types";
import { TeamChip } from "./TeamChip";

const category = (l: Lot) => l.custom_fields?.Category ?? l.custom_fields?.category ?? null;

/** Shown while the previous team decides whether to use a right-to-match card. */
export function RtmBanner({ auction, lots, teamById, myTeam }: { auction: Auction; lots: Lot[]; teamById: Map<string, LeagueTeam>; myTeam: LeagueTeam | null }) {
  const now = useServerNow(250);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lot = lots.find((l) => l.status === "open" && l.rtm_offered);
  if (!lot || !lot.rtm_team_id) return null;
  const rt = teamById.get(lot.rtm_team_id);
  const winner = lot.winner_team_id ? teamById.get(lot.winner_team_id) : undefined;
  const left = lot.ends_at ? new Date(lot.ends_at).getTime() - now : 0;
  const mine = myTeam?.id === lot.rtm_team_id;

  async function decide(match: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc("league_rtm", { p_lot_id: lot!.id, p_match: match });
    setBusy(false);
    setError(error ? errorMessage(error) : null);
  }

  return (
    <div role="status" aria-live="polite" className="glass animate-rise space-y-3 rounded-[24px] p-4">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        {rt && <TeamChip team={rt} />}
        Right to match on "{lot.title}"
      </p>
      <p className="text-sm text-stone-600">
        {winner ? `${winner.name} won at ${money(lot.current_bid, auction.settings)}. ` : ""}
        {rt?.name ?? "The previous team"} can match that price to keep the player.
        {left > 0 && <> {remaining(left)} left.</>}
      </p>
      {mine && auction.status === "live" && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-accent" disabled={busy} onClick={() => void decide(true)}>
            Match {money(lot.current_bid, auction.settings)}
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => void decide(false)}>
            Let them have it
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Host, before the league starts: retentions and right-to-match owners. */
export function LeagueSetupPanel({ auction, lots, teams }: { auction: Auction; lots: Lot[]; teams: LeagueTeam[] }) {
  const [error, setError] = useState<string | null>(null);
  const [retain, setRetain] = useState<Record<string, { team: string; price: string }>>({});
  const league = auction.settings.league ?? {};
  const players = [...lots].filter((l) => l.status === "pending" || l.retained).sort((a, b) => a.position - b.position);
  if (teams.length === 0 || players.length === 0) return null;

  async function run(task: PromiseLike<{ error: unknown }>) {
    const { error } = await task;
    setError(error ? errorMessage(error) : null);
  }

  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="font-display text-lg font-extrabold">Retentions and right to match</h2>
        <p className="text-sm text-stone-500">
          Each team can keep up to {league.retain_max ?? 4} players before the auction (the price comes out of its purse).
          {(league.rtm_cards ?? 0) > 0
            ? ` Teams have ${league.rtm_cards} right-to-match card${league.rtm_cards === 1 ? "" : "s"}: when someone else wins a player you link to a team, that team can match the price.`
            : " Turn on right-to-match cards in the league settings to let previous owners match winning bids."}
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y divide-stone-100">
        {players.map((l) => {
          const r = retain[l.id] ?? { team: teams[0].id, price: String(l.start_price) };
          const owner = l.winner_team_id ? teams.find((t) => t.id === l.winner_team_id) : undefined;
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
              <span className="min-w-0 flex-1 font-medium">
                {l.title}
                {category(l) && <span className="chip ml-1.5 bg-stone-100 text-stone-600">{category(l)}</span>}
              </span>
              {l.retained ? (
                <>
                  <span className="text-stone-600">
                    Retained by {owner?.name ?? "a team"} for {money(l.current_bid, auction.settings)}
                  </span>
                  <button className="btn-ghost px-3 py-1" onClick={() => void run(supabase.rpc("league_unretain", { p_lot_id: l.id }))}>
                    Release
                  </button>
                </>
              ) : (
                <>
                  {(league.rtm_cards ?? 0) > 0 && (
                    <label className="flex items-center gap-1 text-xs text-stone-500">
                      RTM
                      <select
                        className="input w-auto py-1 text-xs"
                        value={l.rtm_team_id ?? ""}
                        onChange={(e) => void run(supabase.from("lots").update({ rtm_team_id: e.target.value || null }).eq("id", l.id))}
                      >
                        <option value="">None</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.short_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <select
                    className="input w-auto py-1 text-xs"
                    aria-label={`Team to retain ${l.title}`}
                    value={r.team}
                    onChange={(e) => setRetain({ ...retain, [l.id]: { ...r, team: e.target.value } })}
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.short_name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input w-24 py-1 text-xs"
                    type="number"
                    min={0}
                    aria-label={`Retention price for ${l.title}`}
                    value={r.price}
                    onChange={(e) => setRetain({ ...retain, [l.id]: { ...r, price: e.target.value } })}
                  />
                  <button
                    className="btn-ghost px-3 py-1"
                    onClick={() => void run(supabase.rpc("league_retain", { p_lot_id: l.id, p_team_id: r.team, p_price: Number(r.price) || 0 }))}
                  >
                    Retain
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface Trade {
  id: string;
  from_team: string;
  to_team: string;
  give_lots: string[];
  get_lots: string[];
  cash: number;
  note: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  created_at: string;
}

/** Trades between teams while the league is paused or after it ends. */
export function TradesPanel({
  auction,
  lots,
  teams,
  myTeam,
  isHost,
}: {
  auction: Auction;
  lots: Lot[];
  teams: LeagueTeam[];
  myTeam: LeagueTeam | null;
  isHost: boolean;
}) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [to, setTo] = useState("");
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [cash, setCash] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const open = auction.status === "paused" || auction.status === "ended";

  useEffect(() => {
    const load = () =>
      void supabase
        .from("league_trades")
        .select("*")
        .eq("auction_id", auction.id)
        .order("created_at", { ascending: false })
        .limit(50)
        .then(({ data }) => setTrades((data as Trade[] | null) ?? []));
    load();
    const ch = supabase
      .channel(channelName(`trades:${auction.id}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "league_trades", filter: `auction_id=eq.${auction.id}` }, load)
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [auction.id]);

  const squad = (teamId: string) => lots.filter((l) => l.winner_team_id === teamId && l.status === "sold");
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const names = (ids: string[]) => ids.map((id) => lotById.get(id)?.title ?? "?").join(", ") || "nothing";

  async function propose(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("league_propose_trade", {
      p_auction_id: auction.id,
      p_to_team: to,
      p_give: give,
      p_get: get,
      p_cash: Number(cash) || 0,
      p_note: note.trim(),
    });
    if (error) return setError(errorMessage(error));
    setError(null);
    setGive([]);
    setGet([]);
    setCash("0");
    setNote("");
  }

  async function respond(t: Trade, accept: boolean) {
    if (accept) {
      const ok = await confirmDialog({ title: "Accept this trade?", body: "Players and cash move between the teams straight away.", confirmLabel: "Accept trade" });
      if (!ok) return;
    }
    const { error } = await supabase.rpc("league_respond_trade", { p_trade_id: t.id, p_accept: accept });
    setError(error ? errorMessage(error) : null);
  }

  return (
    <div className="space-y-4">
      {!open && <p className="card p-5 text-sm text-stone-500">Trades open while the league is paused or after the auction ends.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {open && myTeam && (
        <form onSubmit={propose} className="card space-y-3 p-5">
          <h2 className="font-display text-lg font-extrabold">Propose a trade</h2>
          <select className="input" required value={to} onChange={(e) => (setTo(e.target.value), setGet([]))} aria-label="Trade with team">
            <option value="">Trade with...</option>
            {teams
              .filter((t) => t.id !== myTeam.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <fieldset>
              <legend className="label">You give</legend>
              {squad(myTeam.id).map((l) => (
                <label key={l.id} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" checked={give.includes(l.id)} onChange={() => toggle(give, setGive, l.id)} /> {l.title}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className="label">You get</legend>
              {to ? (
                squad(to).map((l) => (
                  <label key={l.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" checked={get.includes(l.id)} onChange={() => toggle(get, setGet, l.id)} /> {l.title}
                  </label>
                ))
              ) : (
                <p className="text-sm text-stone-500">Pick a team first.</p>
              )}
            </fieldset>
          </div>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div>
              <label className="label" htmlFor="trade-cash">
                You pay (purse)
              </label>
              <input id="trade-cash" className="input" type="number" step="1" value={cash} onChange={(e) => setCash(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="trade-note">
                Note
              </label>
              <input id="trade-note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <button className="btn-accent">Send trade offer</button>
        </form>
      )}

      <section className="card overflow-hidden">
        <h2 className="border-b border-stone-100 px-5 py-3 font-semibold">Trades</h2>
        {trades.length === 0 && <p className="px-5 py-6 text-sm text-stone-500">No trades yet.</p>}
        <ul className="divide-y divide-stone-100 text-sm">
          {trades.map((t) => {
            const from = teamById.get(t.from_team);
            const toTeam = teamById.get(t.to_team);
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <strong>{from?.short_name}</strong> gives {names(t.give_lots)}
                  {Number(t.cash) !== 0 && <> + {money(Math.abs(t.cash), auction.settings)}</>} · <strong>{toTeam?.short_name}</strong> gives {names(t.get_lots)}
                  {t.note && <span className="block text-xs text-stone-500">"{t.note}"</span>}
                </span>
                <span className="chip bg-stone-100 text-stone-700">{t.status}</span>
                {t.status === "pending" && myTeam?.id === t.to_team && (
                  <>
                    <button className="btn-accent px-3 py-1" onClick={() => void respond(t, true)}>
                      Accept
                    </button>
                    <button className="btn-ghost px-3 py-1" onClick={() => void respond(t, false)}>
                      Reject
                    </button>
                  </>
                )}
                {t.status === "pending" && myTeam?.id !== t.to_team && (myTeam?.id === t.from_team || isHost) && (
                  <button className="btn-ghost px-3 py-1" onClick={() => void respond(t, false)}>
                    Cancel
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** Host, after the league ends: copy teams and players into a new season. */
export function NextSeasonButton({ auction }: { auction: Auction }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  async function start() {
    const ok = await confirmDialog({
      title: "Start the next season?",
      body: "A new draft league is created with the same teams (fresh purses) and players. Each player's current team gets the right to match.",
      confirmLabel: "Create next season",
    });
    if (!ok) return;
    const { data, error } = await supabase.rpc("league_next_season", { p_auction_id: auction.id });
    if (error) return setError(errorMessage(error));
    navigate(`/host/a/${data as string}`);
  }
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
      <div>
        <p className="font-semibold">Season over</p>
        <p className="text-sm text-stone-500">Run it back with the same teams and players.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <button className="btn-accent" onClick={() => void start()}>
        Next season
      </button>
    </div>
  );
}
