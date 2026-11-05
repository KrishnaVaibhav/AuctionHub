import { useEffect, useRef, useState } from "react";
import { FireIcon, MegaphoneSimpleIcon, SwordIcon, TimerIcon } from "@phosphor-icons/react";
import { useServerNow } from "../../lib/clock";
import { money, remaining } from "../../lib/format";
import { funOn, hypeLevel, showdown, sounds, vibrate, type PulseEvent } from "../../lib/fun";
import { useProfileNames } from "../../lib/profiles";
import { supabase } from "../../lib/supabase";
import { t } from "../../lib/i18n";
import type { Auction, Lot } from "../../lib/types";

/**
 * The room's first read, in priority order: what's selling, the price, the
 * time left and where you stand. Size and colour follow importance: price and
 * time are largest; your status is the only saturated block; everything else
 * is small and quiet.
 */
export function LiveStage({ auction, lot, userId, events, isTeam }: { auction: Auction; lot: Lot; userId: string | null; events: PulseEvent[]; isTeam: boolean }) {
  const now = useServerNow(250);
  const live = auction.status === "live" && lot.status === "open";
  const ms = lot.ends_at ? new Date(lot.ends_at).getTime() - now : 0;
  const secs = Math.ceil(ms / 1000);
  const final = live && ms > 0 && ms <= 10_000;
  const hype = funOn(auction.settings, "hype") ? hypeLevel(events, Date.now(), lot.id) : 0;
  const duel = funOn(auction.settings, "hype") ? showdown(events, lot.id) : null;
  const names = useProfileNames(duel ?? []);
  const winning = userId != null && lot.current_winner_id === userId;
  const hasBid = useHasBid(lot.id, userId, winning);
  const outbid = !winning && userId != null && lot.bid_count > 0 && (hasBid || events.some((e) => e.lotId === lot.id && e.kind === "bid" && e.winner === userId));

  // "Extended!" toast when anti-snipe or the host adds time.
  const [extended, setExtended] = useState(false);
  const seen = useRef(events.length);
  useEffect(() => {
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    if (fresh.some((e) => e.lotId === lot.id && e.kind === "extend")) {
      setExtended(true);
      const id = setTimeout(() => setExtended(false), 3000);
      return () => clearTimeout(id);
    }
    if (fresh.some((e) => e.lotId === lot.id && e.kind === "bid") && funOn(auction.settings, "sounds")) sounds.bid();
  }, [events, lot.id, auction.settings]);

  // Ticks in the last 5 seconds.
  const lastTick = useRef(0);
  useEffect(() => {
    if (!final || !funOn(auction.settings, "sounds") || secs > 5 || secs === lastTick.current) return;
    lastTick.current = secs;
    sounds.tick();
    if (secs <= 3) vibrate(30);
  }, [final, secs, auction.settings]);

  const status = !userId || isTeam
    ? null
    : winning
      ? { text: t("You're winning"), cls: "bg-emerald-500 text-snow shadow-[0_8px_24px_-8px_rgb(16_185_129/0.7)]" }
      : outbid
        ? { text: t("Outbid"), cls: "animate-pulse bg-red-600 text-snow shadow-[0_8px_24px_-8px_rgb(220_38_38/0.7)]" }
        : null;

  return (
    <section
      aria-label={t("Live now")}
      className={`relative overflow-hidden rounded-[30px] border p-4 transition-shadow duration-500 sm:p-5 ${
        hype >= 0.75 ? "border-brand-400 shadow-[0_0_0_4px_rgb(251_191_36/0.25),0_20px_60px_-20px_rgb(245_158_11/0.6)]" : "border-stone-900/[0.06]"
      } glass`}
    >
      {auction.announcement && (
        <p className="mb-3 flex items-start gap-2 rounded-2xl bg-brand-400 px-3.5 py-2 text-sm font-semibold text-ink">
          <MegaphoneSimpleIcon size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{auction.announcement}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Priority 1: price */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-stone-500">
            {live && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" aria-hidden="true" />}
            #{lot.position + 1} · {lot.title}
          </p>
          <p key={String(lot.current_bid)} className="mt-0.5 inline-block origin-left animate-bump rounded-lg font-display text-5xl leading-none font-extrabold tracking-tight tabular-nums sm:text-6xl">
            {money(lot.current_bid ?? lot.start_price, auction.settings)}
          </p>
          <p className="mt-1 text-xs text-stone-500 tabular-nums">
            {lot.bid_count > 0 ? t("Bids: {n}", { n: lot.bid_count }) : t("Opening price")}
          </p>
        </div>

        {/* Priority 2: time left */}
        {live && lot.ends_at && (
          <div className={`text-right ${final ? "text-red-600" : ""}`} aria-live={final ? "assertive" : "off"}>
            <p className="flex items-center justify-end gap-1 text-xs font-semibold text-stone-500">
              <TimerIcon size={14} weight="bold" aria-hidden="true" />
              {t("Time left")}
            </p>
            <p className={`font-mono text-4xl font-bold tabular-nums sm:text-5xl ${final ? "animate-[heartbeat_1s_ease-in-out_infinite]" : ""}`}>
              {ms > 0 ? remaining(ms) : t("Closing...")}
            </p>
          </div>
        )}

        {/* Priority 3: where you stand */}
        {status && <p className={`w-full rounded-2xl px-4 py-2.5 text-center font-display text-lg font-extrabold sm:w-auto ${status.cls}`}>{status.text}</p>}
      </div>

      {/* Hype meter, showdown, extension: only when something is happening. */}
      {live && funOn(auction.settings, "hype") && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-stone-900/[0.07]" role="meter" aria-label={t("Hype")} aria-valuenow={Math.round(hype * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-500 to-rose-500 transition-[width] duration-700 ease-[var(--ease-spring)]"
              style={{ width: `${Math.max(4, hype * 100)}%` }}
            />
          </div>
          {hype >= 0.75 && (
            <span className="chip animate-bump bg-rose-500 py-1 text-snow">
              <FireIcon size={14} weight="fill" aria-hidden="true" /> {t("On fire")}
            </span>
          )}
          {duel && (
            <span className="chip bg-ink py-1 text-snow">
              <SwordIcon size={14} weight="fill" aria-hidden="true" />
              {t("Showdown: {a} vs {b}", { a: duel[0] === userId ? t("You") : (names.get(duel[0]) ?? "?"), b: duel[1] === userId ? t("You") : (names.get(duel[1]) ?? "?") })}
            </span>
          )}
          {extended && <span className="chip animate-bump bg-sky-500 py-1 text-snow">{t("Extended!")}</span>}
        </div>
      )}
    </section>
  );
}

/**
 * Whether this user has ever bid on the lot. Asked once per lot from the
 * server (so "Outbid" survives a reload), then remembered once they lead.
 */
function useHasBid(lotId: string, userId: string | null, winning: boolean): boolean {
  const [known, setKnown] = useState<{ lotId: string; has: boolean } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void supabase
      .from("bids")
      .select("id")
      .eq("lot_id", lotId)
      .eq("bidder_id", userId)
      .limit(1)
      .then(({ data }) => {
        if (alive) setKnown((k) => (k?.lotId === lotId && k.has ? k : { lotId, has: (data?.length ?? 0) > 0 }));
      });
    return () => {
      alive = false;
    };
  }, [lotId, userId]);
  useEffect(() => {
    if (winning) setKnown({ lotId, has: true });
  }, [winning, lotId]);
  return known?.lotId === lotId && known.has;
}
