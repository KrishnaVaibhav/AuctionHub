import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { RobotIcon, XIcon } from "@phosphor-icons/react";
import { money } from "../../lib/format";
import type { Auction, Lot } from "../../lib/types";

interface Bot {
  name: string;
  short: string;
  color: string;
  purse: number;
  squad: string[];
}
const BOT_TEAMS = [
  ["Bot Blasters", "BB", "#ef4444"],
  ["Robo Royals", "RR", "#8b5cf6"],
  ["Circuit Kings", "CK", "#0ea5e9"],
] as const;

/**
 * Practice draft against three bots, entirely in the browser: same players,
 * same purse, a short timer. Nothing is saved and nothing touches the real league.
 */
export function MockDraft({ auction, lots }: { auction: Auction; lots: Lot[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-ghost" onClick={() => setOpen(true)} disabled={lots.length === 0}>
        <RobotIcon size={16} weight="bold" aria-hidden="true" />
        Practice draft
      </button>
      {open && createPortal(<Draft auction={auction} lots={lots} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Draft({ auction, lots, onClose }: { auction: Auction; lots: Lot[]; onClose: () => void }) {
  const s = auction.settings;
  const purse = Number(s.league?.purse ?? 1000);
  const squadMax = Number(s.league?.squad_max ?? 15);
  const pool = useMemo(() => lots.filter((l) => l.status !== "withdrawn").slice(0, 60), [lots]);
  // Each bot values each player at 1x to 3.5x its base, fixed for the session.
  const values = useMemo(() => pool.map(() => BOT_TEAMS.map(() => 1 + Math.random() * 2.5)), [pool]);
  const [bots, setBots] = useState<Bot[]>(() => BOT_TEAMS.map(([name, short, color]) => ({ name, short, color, purse, squad: [] })));
  const [me, setMe] = useState({ purse, squad: [] as string[] });
  const [i, setI] = useState(0);
  const [price, setPrice] = useState(Number(pool[0]?.start_price ?? 0));
  const [leader, setLeader] = useState<number | null>(null); // -1 = you, 0..2 bots
  const [left, setLeft] = useState(8);
  const [log, setLog] = useState<string[]>([]);
  const step = (p: number) => Math.max(1, Math.round(p * 0.1));
  const lot = pool[i];

  // One tick per second: the clock runs down, bots may raise, and the player sells at zero.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!lot) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [i, lot]);

  useEffect(() => {
    if (!lot || tick === 0) return;
    let nextLeft = left - 1;
    const next = leader == null ? price : price + step(price);
    const keen = bots
      .map((b, k) => ({ b, k }))
      .filter(({ b, k }) => k !== leader && b.purse >= next && b.squad.length < squadMax && next <= Number(lot.start_price) * values[i][k] && Math.random() < 0.45);
    if (keen.length > 0 && nextLeft > 0) {
      setLeader(keen[Math.floor(Math.random() * keen.length)].k);
      setPrice(next);
      nextLeft = Math.max(nextLeft, 4);
    }
    if (nextLeft > 0) return setLeft(nextLeft);

    const line =
      leader == null ? `${lot.title}: unsold` : leader === -1 ? `${lot.title}: yours for ${money(price, s)}` : `${lot.title}: ${bots[leader].short} for ${money(price, s)}`;
    if (leader === -1) setMe((m) => ({ purse: m.purse - price, squad: [...m.squad, lot.title] }));
    else if (leader != null) setBots((bs) => bs.map((b, k) => (k === leader ? { ...b, purse: b.purse - price, squad: [...b.squad, lot.title] } : b)));
    setLog((l) => [line, ...l].slice(0, 8));
    setI(i + 1);
    setPrice(Number(pool[i + 1]?.start_price ?? 0));
    setLeader(null);
    setLeft(8);
  }, [tick]);

  function bid() {
    const next = leader == null ? price : price + step(price);
    if (next > me.purse || me.squad.length >= squadMax) return;
    setPrice(next);
    setLeader(-1);
    setLeft((l) => Math.max(l, 5));
  }

  return (
    <div className="scrim flex items-center justify-center p-3" onClick={onClose}>
      <div className="glass-thick max-h-[92dvh] w-full max-w-2xl animate-rise space-y-4 overflow-y-auto rounded-[32px] p-5 sm:p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Practice draft">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="section-title">Practice draft</h2>
            <p className="text-xs text-stone-500">Against three bots. Nothing here is saved.</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <XIcon size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {lot ? (
          <div className="rounded-[26px] p-5 text-snow" style={{ background: `linear-gradient(135deg, #0c0a09 45%, ${leader != null && leader >= 0 ? bots[leader].color : leader === -1 ? "#10b981" : "#44403c"})` }}>
            <p className="text-xs font-semibold tracking-widest text-brand-300 uppercase">
              Player {i + 1} of {pool.length}
            </p>
            <p className="mt-1 font-display text-3xl font-extrabold tracking-tight">{lot.title}</p>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs text-snow/60">{leader == null ? "Base price" : leader === -1 ? "You lead" : `${bots[leader].name} lead`}</p>
                <p key={price} className="animate-bump font-display text-5xl font-extrabold tabular-nums">{money(price, s)}</p>
              </div>
              <p className={`font-mono text-5xl font-bold tabular-nums ${left <= 3 ? "text-red-400" : ""}`}>{left}</p>
            </div>
            <button className="btn-accent mt-4 w-full py-3 text-base" onClick={bid} disabled={leader === -1 || (leader == null ? price : price + step(price)) > me.purse}>
              Bid {money(leader == null ? price : price + step(price), s)}
            </button>
          </div>
        ) : (
          <p className="card p-6 text-center font-semibold">Draft complete. You bought {me.squad.length} players.</p>
        )}

        <div className="grid gap-2 sm:grid-cols-4">
          <div className="card p-3">
            <p className="text-xs font-semibold text-emerald-700">You</p>
            <p className="font-display font-extrabold tabular-nums">{money(me.purse, s)}</p>
            <p className="text-xs text-stone-500">{me.squad.length} players</p>
          </div>
          {bots.map((b) => (
            <div key={b.short} className="card p-3">
              <p className="text-xs font-semibold" style={{ color: b.color }}>
                {b.name}
              </p>
              <p className="font-display font-extrabold tabular-nums">{money(b.purse, s)}</p>
              <p className="text-xs text-stone-500">{b.squad.length} players</p>
            </div>
          ))}
        </div>
        {log.length > 0 && (
          <ul className="space-y-0.5 text-xs text-stone-600">
            {log.map((l, k) => (
              <li key={k}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
