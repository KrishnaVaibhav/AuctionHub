import { useEffect, useRef, useState } from "react";
import { supabase, channelName } from "../../lib/supabase";
import { prefersReducedMotion } from "../../lib/fun";
import { t } from "../../lib/i18n";

const EMOJI = ["🔥", "👏", "😮", "😂", "💸", "❤️"];
const BUCKET_MS = 15_000;
const BUCKETS = 20; // 5 minutes

interface Floater {
  id: number;
  emoji: string;
  dx: number;
  left: number;
}

/**
 * Viewers tap emoji that float up the screen for everyone in the room.
 * Sent over Realtime broadcast: nothing is stored. Hosts also get a heat
 * strip of the last five minutes.
 */
export function Reactions({ auctionId, showHeat }: { auctionId: string; showHeat: boolean }) {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [heat, setHeat] = useState<number[]>(() => Array(BUCKETS).fill(0));
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const last = useRef(0);
  const nextId = useRef(0);

  const spawn = (emoji: string) => {
    setHeat((h) => {
      const next = h.slice();
      next[next.length - 1] += 1;
      return next;
    });
    if (prefersReducedMotion()) return;
    const id = nextId.current++;
    setFloaters((f) => [...f.slice(-30), { id, emoji, dx: Math.round(Math.random() * 40 - 20), left: Math.round(Math.random() * 70) }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 2600);
  };

  useEffect(() => {
    const ch = supabase
      .channel(channelName(`reactions:${auctionId}`), { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "react" }, ({ payload }) => {
        const e = String((payload as { e?: string }).e ?? "");
        if (EMOJI.includes(e)) spawn(e);
      })
      .subscribe();
    channel.current = ch;
    // Shift the heat strip every bucket.
    const id = setInterval(() => setHeat((h) => [...h.slice(1), 0]), BUCKET_MS);
    return () => {
      clearInterval(id);
      void supabase.removeChannel(ch);
    };
  }, [auctionId]);

  function send(emoji: string) {
    const now = Date.now();
    if (now - last.current < 350) return;
    last.current = now;
    spawn(emoji);
    void channel.current?.send({ type: "broadcast", event: "react", payload: { e: emoji } });
  }

  const peak = Math.max(1, ...heat);

  return (
    <>
      <div className="glass flex items-center gap-1 rounded-full p-1" role="group" aria-label={t("React")}>
        {EMOJI.map((e) => (
          <button key={e} className="flex h-10 w-10 items-center justify-center rounded-full text-xl transition hover:scale-110 hover:bg-white/60 active:scale-90 dark:hover:bg-snow/10" onClick={() => send(e)} aria-label={t("React {emoji}", { emoji: e })}>
            {e}
          </button>
        ))}
      </div>
      {showHeat && (
        <div className="flex h-8 items-end gap-0.5" role="img" aria-label={t("Reactions over the last 5 minutes")} title={t("Reactions over the last 5 minutes")}>
          {heat.map((n, i) => (
            <span key={i} className="w-1.5 rounded-full bg-rose-400 transition-[height] duration-500" style={{ height: `${Math.max(8, (n / peak) * 100)}%`, opacity: n ? 1 : 0.25 }} />
          ))}
        </div>
      )}
      <div className="pointer-events-none fixed right-4 bottom-24 z-40 h-72 w-40 lg:bottom-8" aria-hidden="true">
        {floaters.map((f) => (
          <span
            key={f.id}
            className="absolute bottom-0 text-3xl"
            style={{ left: `${f.left}%`, animation: "float-up 2.6s cubic-bezier(0.2, 0.7, 0.3, 1) both", ["--dx" as string]: `${f.dx}px` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>
    </>
  );
}
