import { useEffect, useMemo, useState } from "react";
import { ArrowCounterClockwiseIcon, PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../lib/supabase";
import { money } from "../lib/format";
import { useProfileNames } from "../lib/profiles";
import { t } from "../lib/i18n";
import type { Auction, Lot } from "../lib/types";
import { Segmented } from "./Glass";

interface ReplayBid {
  id: number;
  lot_id: string;
  bidder_id: string;
  team_id: string | null;
  amount: number;
  is_auto: boolean;
  created_at: string;
}
interface TeamLite {
  id: string;
  name: string;
  short_name: string;
  color: string;
}

const SPEEDS = [1, 2, 4, 8];
const PAGE = 1000;
const MAX_BIDS = 20000;

/** Plays an ended auction's bids back in order: a spotlight on each bid, a race of the top lots and a running feed. */
export function BidReplay({ auction, lots }: { auction: Auction; lots: Lot[] }) {
  const [bids, setBids] = useState<ReplayBid[] | null>(null);
  const [teams, setTeams] = useState<Map<string, TeamLite>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const names = useProfileNames([...new Set((bids ?? []).map((b) => b.bidder_id))]);
  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = lots.map((l) => l.id);
      if (ids.length === 0) return setBids([]);
      const all: ReplayBid[] = [];
      for (let from = 0; from < MAX_BIDS; from += PAGE) {
        const { data, error } = await supabase
          .from("bids")
          .select("id, lot_id, bidder_id, team_id, amount, is_auto, created_at")
          .in("lot_id", ids)
          .order("created_at")
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) {
          if (!cancelled) setError(errorMessage(error));
          return;
        }
        all.push(...((data as ReplayBid[]) ?? []));
        if (!data || data.length < PAGE) break;
      }
      if (auction.mode === "league") {
        const { data } = await supabase.from("league_teams").select("id, name, short_name, color").eq("auction_id", auction.id);
        if (!cancelled) setTeams(new Map(((data as TeamLite[]) ?? []).map((x) => [x.id, x])));
      }
      if (!cancelled) {
        setBids(all);
        setIndex(Math.min(1, all.length));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auction.id, auction.mode, lots.length]);

  // Advance one bid per tick while playing.
  useEffect(() => {
    if (!playing || !bids) return;
    if (index >= bids.length) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setIndex((i) => i + 1), 700 / speed);
    return () => clearTimeout(id);
  }, [playing, index, speed, bids]);

  const state = useMemo(() => {
    const price = new Map<string, { amount: number; who: string; team: string | null; count: number }>();
    for (const b of (bids ?? []).slice(0, index)) {
      const prev = price.get(b.lot_id);
      price.set(b.lot_id, { amount: Number(b.amount), who: b.bidder_id, team: b.team_id, count: (prev?.count ?? 0) + 1 });
    }
    return price;
  }, [bids, index]);

  const finalMax = useMemo(() => Math.max(1, ...(bids ?? []).map((b) => Number(b.amount))), [bids]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (bids === null) return <div className="h-64 animate-pulse rounded-[28px] bg-stone-900/[0.05]" />;
  if (bids.length === 0) return <div className="card py-16 text-center text-sm text-stone-500">{t("No bids to replay.")}</div>;

  const current = bids[Math.max(0, index - 1)];
  const currentLot = lotById.get(current.lot_id);
  const first = new Date(bids[0].created_at).getTime();
  const at = new Date(current.created_at).getTime();
  const label = (b: { who: string; team: string | null }) => (b.team ? teams.get(b.team)?.short_name : null) ?? names.get(b.who) ?? "Bidder";
  const race = [...state.entries()].sort((a, b) => b[1].amount - a[1].amount).slice(0, 8);
  const feed = bids.slice(Math.max(0, index - 6), index).reverse();
  const elapsed = Math.round((at - first) / 1000);
  const clock = `${Math.floor(elapsed / 3600)}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="animate-rise space-y-4">
      {/* Spotlight */}
      <div
        className="relative overflow-hidden rounded-[32px] p-5 text-snow sm:p-7"
        style={{
          background: `linear-gradient(135deg, #0c0a09 45%, ${(current.team_id && teams.get(current.team_id)?.color) || "#b45309"})`,
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-widest text-brand-300 uppercase">
              {t("Bid {n} of {total}", { n: index, total: bids.length })}
            </p>
            <h3 className="mt-1 truncate font-display text-2xl font-extrabold tracking-tight">
              {currentLot ? `#${currentLot.position + 1} ${currentLot.title}` : "-"}
            </h3>
            <p key={current.id} className="mt-3 inline-block animate-bump rounded-lg font-display text-5xl font-extrabold tabular-nums">
              {money(current.amount, auction.settings)}
            </p>
            <p className="mt-2 text-sm text-snow/80">
              {label({ who: current.bidder_id, team: current.team_id })}
              {current.is_auto && <span className="chip ml-2 bg-snow/15 text-[10px] text-snow">AUTO</span>}
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-3xl font-bold tabular-nums">{clock}</p>
            <p className="text-xs text-snow/60">{new Date(at).toLocaleString()}</p>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-snow/10">
          <div className="h-full bg-brand-400 transition-[width] duration-300" style={{ width: `${(index / bids.length) * 100}%` }} />
        </div>
      </div>

      {/* Controls */}
      <div className="glass flex flex-wrap items-center gap-3 rounded-[26px] p-2">
        <button
          className="btn-accent h-11 w-11 p-0"
          onClick={() => {
            if (index >= bids.length) setIndex(1);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? t("Pause replay") : t("Play replay")}
        >
          {playing ? <PauseIcon size={18} weight="fill" aria-hidden="true" /> : <PlayIcon size={18} weight="fill" aria-hidden="true" />}
        </button>
        <button className="btn-icon" onClick={() => { setPlaying(false); setIndex(1); }} aria-label={t("Restart replay")}>
          <ArrowCounterClockwiseIcon size={18} weight="bold" aria-hidden="true" />
        </button>
        <input
          type="range"
          min={1}
          max={bids.length}
          value={index}
          onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }}
          className="min-w-32 flex-1 accent-brand-500"
          aria-label={t("Replay position")}
        />
        <Segmented
          aria-label={t("Replay speed")}
          width={52}
          value={String(speed)}
          onChange={(v) => setSpeed(Number(v) as typeof speed)}
          items={SPEEDS.map((s) => ({ value: String(s), label: <span className="tabular-nums">{s}x</span> }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Race of the top lots */}
        <div className="card space-y-2.5 p-4 sm:p-5">
          <h3 className="section-title text-base">{t("Top lots so far")}</h3>
          {race.map(([lotId, s]) => {
            const l = lotById.get(lotId);
            return (
              <div key={lotId} className={lotId === current.lot_id ? "text-stone-900" : "text-stone-600"}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{l ? `#${l.position + 1} ${l.title}` : "-"}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(s.amount, auction.settings)}</span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-stone-900/[0.06]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-[var(--ease-spring)] ${lotId === current.lot_id ? "bg-brand-500" : "bg-stone-400"}`}
                    style={{ width: `${Math.max(3, (s.amount / finalMax) * 100)}%`, ...(s.team && teams.get(s.team) ? { background: teams.get(s.team)!.color } : {}) }}
                  />
                </div>
                <p className="mt-0.5 text-[11px] text-stone-500">
                  {label(s)} · {t("{n} bids", { n: s.count })}
                </p>
              </div>
            );
          })}
        </div>

        {/* Feed */}
        <div className="card p-4 sm:p-5">
          <h3 className="section-title text-base">{t("Latest bids")}</h3>
          <ul className="mt-2 divide-y divide-stone-900/[0.06] text-sm">
            {feed.map((b) => (
              <li key={b.id} className="animate-rise py-2">
                <p className="flex justify-between gap-2">
                  <span className="truncate font-medium">{label({ who: b.bidder_id, team: b.team_id })}</span>
                  <span className="font-semibold tabular-nums">{money(b.amount, auction.settings)}</span>
                </p>
                <p className="truncate text-xs text-stone-500">{lotById.get(b.lot_id)?.title ?? ""}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
