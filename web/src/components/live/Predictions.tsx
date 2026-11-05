import { useEffect, useState, type FormEvent } from "react";
import { TargetIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../../lib/supabase";
import { money } from "../../lib/format";
import { funOn } from "../../lib/fun";
import { useProfileNames } from "../../lib/profiles";
import { t } from "../../lib/i18n";
import type { Auction, LeagueTeam, Lot } from "../../lib/types";
import { TeamChip } from "../league/TeamChip";

interface Prediction {
  lot_id: string;
  user_id: string;
  kind: "price" | "team";
  amount: number | null;
  team_id: string | null;
  points: number | null;
}

function usePredictions(lot: Lot, userId: string | null) {
  const [mine, setMine] = useState<Prediction[]>([]);
  const [all, setAll] = useState<Prediction[]>([]);
  const [counts, setCounts] = useState({ guesses: 0, picks: 0 });
  const closed = lot.status === "sold" || lot.status === "unsold" || lot.status === "withdrawn";

  async function reload() {
    const [{ data }, { data: c }] = await Promise.all([
      supabase.from("predictions").select("*").eq("lot_id", lot.id),
      supabase.rpc("prediction_counts", { p_auction_id: lot.auction_id }),
    ]);
    const rows = (data as Prediction[] | null) ?? [];
    setAll(rows);
    setMine(rows.filter((r) => r.user_id === userId));
    const row = ((c as { lot_id: string; guesses: number; picks: number }[] | null) ?? []).find((r) => r.lot_id === lot.id);
    setCounts({ guesses: row?.guesses ?? 0, picks: row?.picks ?? 0 });
  }
  useEffect(() => {
    void reload();
  }, [lot.id, lot.status, userId]);
  return { mine, all, counts, closed, reload };
}

/** Guess the final price before bidding starts; revealed and scored when the lot closes. */
export function GuessPanel({ auction, lot, userId, isTeam }: { auction: Auction; lot: Lot; userId: string | null; isTeam: boolean }) {
  const { mine, all, counts, closed, reload } = usePredictions(lot, userId);
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const names = useProfileNames(all.map((p) => p.user_id));
  const my = mine.find((p) => p.kind === "price");
  const open = !closed && lot.bid_count === 0 && lot.current_bid == null;
  if (!funOn(auction.settings, "guesses") || auction.mode === "league") return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("make_prediction", { p_lot_id: lot.id, p_kind: "price", p_amount: Number(amount), p_team_id: null });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: t("Locked in. Scored when the lot closes.") });
    if (!error) await reload();
  }

  const top = all.filter((p) => p.kind === "price" && p.points != null).sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, 3);

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <TargetIcon size={18} weight="bold" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t("Guess the price")}</p>
          <p className="text-xs text-stone-500">{t("{n} guesses · closest wins up to 100 points", { n: counts.guesses })}</p>
        </div>
      </div>

      {closed ? (
        <div className="space-y-1.5 text-sm">
          {my && (
            <p className="rounded-2xl bg-amber-50 px-3 py-2 font-medium text-amber-800">
              {t("Your guess {amount}: {points} points", { amount: money(my.amount, auction.settings), points: my.points ?? 0 })}
            </p>
          )}
          {top.map((p, i) => (
            <p key={p.user_id} className="flex justify-between gap-2">
              <span className="truncate">
                {i + 1}. {names.get(p.user_id) ?? "..."} · {money(p.amount, auction.settings)}
              </span>
              <span className="font-semibold tabular-nums">{p.points}</span>
            </p>
          ))}
        </div>
      ) : open && userId && !isTeam ? (
        <form onSubmit={submit} className="flex gap-2">
          <label className="sr-only" htmlFor={`guess-${lot.id}`}>
            {t("Your guess")}
          </label>
          <input id={`guess-${lot.id}`} type="number" min={1} step="any" className="input" required placeholder={my ? money(my.amount, auction.settings) : t("Final price?")} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn-primary shrink-0">{my ? t("Change") : t("Guess")}</button>
        </form>
      ) : (
        <p className="text-sm text-stone-500">
          {my ? t("Your guess: {amount}", { amount: money(my.amount, auction.settings) }) : !userId ? t("Sign in to play.") : isTeam ? t("Hosts can't play.") : t("Guesses are locked once bidding starts.")}
        </p>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}

/** League pick'em: which team buys this player? */
export function PickemPanel({ auction, lot, teams, userId, isTeam }: { auction: Auction; lot: Lot; teams: LeagueTeam[]; userId: string | null; isTeam: boolean }) {
  const { mine, counts, closed, reload } = usePredictions(lot, userId);
  const [err, setErr] = useState<string | null>(null);
  const my = mine.find((p) => p.kind === "team");
  const open = !closed && lot.bid_count === 0 && lot.current_bid == null;
  if (!funOn(auction.settings, "pickem") || teams.length < 2) return null;

  async function pick(teamId: string) {
    const { error } = await supabase.rpc("make_prediction", { p_lot_id: lot.id, p_kind: "team", p_amount: null, p_team_id: teamId });
    setErr(error ? errorMessage(error) : null);
    if (!error) await reload();
  }

  return (
    <div className="card space-y-3 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <UsersThreeIcon size={18} weight="bold" className="text-violet-600" aria-hidden="true" />
        {t("Pick'em: who buys {player}?", { player: lot.title })}
        <span className="ml-auto text-xs font-normal text-stone-500">{t("{n} picks", { n: counts.picks })}</span>
      </p>
      {closed && my ? (
        <p className={`rounded-2xl px-3 py-2 text-sm font-medium ${my.points ? "bg-emerald-50 text-emerald-800" : "bg-stone-900/[0.04] text-stone-600"}`}>
          {my.points ? t("Correct! +{n} points", { n: my.points }) : t("Not this time.")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {teams.map((tm) => (
            <button
              key={tm.id}
              disabled={!open || !userId || isTeam}
              onClick={() => void pick(tm.id)}
              aria-pressed={my?.team_id === tm.id}
              className={`choice flex items-center gap-2 py-2 ${my?.team_id === tm.id ? "choice-on" : ""}`}
            >
              <TeamChip team={tm} />
              <span className="text-sm font-medium">{tm.name}</span>
            </button>
          ))}
        </div>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

/** Weekly top guessers. */
export function GuessLeaderboard({ auctionId, days = 7, compact = false }: { auctionId?: string; days?: number; compact?: boolean }) {
  const [rows, setRows] = useState<{ user_id: string; display_name: string; points: number; guesses: number; rank: number }[]>([]);
  useEffect(() => {
    void supabase.rpc("prediction_leaderboard", { p_days: days, p_auction_id: auctionId ?? null }).then(({ data }) => setRows((data as typeof rows) ?? []));
  }, [auctionId, days]);
  if (rows.length === 0) return compact ? null : <p className="text-sm text-stone-500">{t("No scored guesses yet.")}</p>;
  return (
    <ol className="space-y-1.5 text-sm">
      {rows.slice(0, compact ? 5 : 25).map((r) => (
        <li key={r.user_id} className="flex items-center gap-3">
          <span className={`flex h-7 w-7 items-center justify-center rounded-full font-display text-xs font-extrabold ${r.rank === 1 ? "bg-brand-400 text-ink" : r.rank === 2 ? "bg-stone-300 text-ink" : r.rank === 3 ? "bg-orange-300 text-ink" : "text-stone-500"}`}>
            {r.rank}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{r.display_name}</span>
          <span className="font-display font-extrabold tabular-nums">{r.points}</span>
        </li>
      ))}
    </ol>
  );
}
