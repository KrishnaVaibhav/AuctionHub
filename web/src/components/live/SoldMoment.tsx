import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GavelIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { money } from "../../lib/format";
import { funOn, sounds, vibrate, type PulseEvent } from "../../lib/fun";
import { useProfileNames } from "../../lib/profiles";
import { shareCard } from "../../lib/shareCard";
import { t } from "../../lib/i18n";
import type { Auction, Lot } from "../../lib/types";
import { Confetti } from "./Confetti";

/** Full-screen "Sold!" moment when a lot sells while you watch. Tap anywhere or wait to dismiss. */
export function SoldMoment({ auction, lots, events, userId, teamName }: { auction: Auction; lots: Lot[]; events: PulseEvent[]; userId: string | null; teamName?: (id: string) => string | undefined }) {
  const [shown, setShown] = useState<PulseEvent | null>(null);
  const [count, setCount] = useState(0);
  const seen = useRef(events.length);
  const lot = shown ? lots.find((l) => l.id === shown.lotId) : undefined;
  const winnerId = shown?.winner ?? null;
  const names = useProfileNames(winnerId ? [winnerId] : []);
  const mine = winnerId != null && winnerId === userId;

  useEffect(() => {
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    const sold = [...fresh].reverse().find((e) => e.kind === "sold");
    if (!sold || !funOn(auction.settings, "celebrate")) return;
    setShown(sold);
    if (funOn(auction.settings, "sounds")) {
      sounds.gavel();
      if (sold.winner === userId) setTimeout(sounds.fanfare, 350);
    }
    vibrate(sold.winner === userId ? [60, 40, 120] : 40);
  }, [events, auction.settings, userId]);

  // Count the price up.
  useEffect(() => {
    if (!shown?.amount) return;
    const target = Number(shown.amount);
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      setCount(target * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const close = setTimeout(() => setShown(null), mine ? 9000 : 3800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(close);
    };
  }, [shown, mine]);

  if (!shown || !lot) return null;
  const who = mine ? t("You") : ((winnerId && (teamName?.(winnerId) ?? names.get(winnerId))) ?? t("the winner"));

  return createPortal(
    <div className="scrim z-[60] flex items-center justify-center p-4" onClick={() => setShown(null)} role="dialog" aria-live="assertive" aria-label={t("Sold")}>
      <Confetti pieces={mine ? 90 : 50} />
      <div className="glass-thick relative w-full max-w-md animate-rise rounded-[36px] p-8 text-center" onClick={(e) => e.stopPropagation()}>
        <GavelIcon size={64} weight="fill" className="mx-auto origin-bottom-right animate-[gavel_0.6s_var(--ease-spring)_both] text-brand-500" aria-hidden="true" />
        <p className="mt-3 font-display text-5xl font-extrabold tracking-tight text-brand-600">{t("Sold!")}</p>
        <p className="mt-2 truncate text-sm text-stone-500">
          #{lot.position + 1} {lot.title}
        </p>
        <p className="mt-4 font-display text-5xl font-extrabold tabular-nums">{money(count, auction.settings)}</p>
        <p className="mt-2 text-base">
          {t("to")} <strong>{who}</strong>
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {mine && (
            <button
              className="btn-accent"
              onClick={() =>
                void shareCard({ eyebrow: "I won", headline: lot.title, big: money(shown.amount ?? 0, auction.settings), footer: auction.title }, "auctionhub-win.png")
              }
            >
              <ShareNetworkIcon size={16} weight="bold" aria-hidden="true" /> {t("Share my win")}
            </button>
          )}
          <button className="btn-ghost" onClick={() => setShown(null)}>
            {t("Close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
