import { useEffect, useMemo, useState } from "react";
import { CheckIcon, GridNineIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../../lib/supabase";
import { BINGO_EVENTS, bingoCard, bingoHits, bingoLine, funOn, type PulseEvent } from "../../lib/fun";
import { t } from "../../lib/i18n";
import type { Auction, Lot } from "../../lib/types";
import { Confetti } from "./Confetti";

const label = new Map(BINGO_EVENTS.map((e) => [e.key, e.label]));

interface ServerState {
  card: string[] | null;
  hits: string[];
  claimed: boolean;
  line: boolean;
}

/**
 * A 3x3 card of room events. Signed-in viewers get a card dealt by the server,
 * which also decides which squares have happened and whether a line is real.
 * Guests see a local card for fun (they can't claim).
 */
export function BingoCard({ auction, lots, events, userId }: { auction: Auction; lots: Lot[]; events: PulseEvent[]; userId: string | null }) {
  const localCard = useMemo(() => bingoCard(`${userId ?? "guest"}:${auction.id}`), [userId, auction.id]);
  const [server, setServer] = useState<ServerState | null>(null);
  const on = funOn(auction.settings, "bingo");

  // Re-ask the server shortly after anything changes in the room.
  const pulse = `${events.length}:${lots.map((l) => `${l.status}${l.bid_count}`).join(",")}`;
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const id = setTimeout(() => {
      void supabase.rpc("bingo_state", { p_auction_id: auction.id }).then(({ data, error }) => {
        if (alive && !error && data) setServer(data as ServerState);
      });
    }, 1200);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [auction.id, userId, pulse, on]);

  const card = server?.card ?? localCard;
  const hits = useMemo(() => {
    const local = bingoHits(lots, events);
    // The server's view wins for signed-in viewers; the live pulse fills the gap until it answers.
    return server ? new Set([...server.hits, ...(server.card ? [] : local)]) : local;
  }, [server, lots, events]);
  const line = bingoLine(card, hits);
  const canClaim = Boolean(userId && server?.card && server.line);
  const [claimed, setClaimed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const done = claimed || Boolean(server?.claimed);
  if (!on) return null;

  async function claim() {
    const { error } = await supabase.rpc("claim_bingo", { p_auction_id: auction.id });
    if (error) setMsg(errorMessage(error));
    else setClaimed(true);
  }

  return (
    <div className="card relative space-y-3 overflow-hidden p-4">
      {claimed && <Confetti pieces={40} />}
      <p className="flex items-center gap-2 font-semibold">
        <GridNineIcon size={18} weight="bold" className="text-rose-500" aria-hidden="true" />
        {t("Room bingo")}
        <span className="ml-auto text-xs font-normal text-stone-500">{t("{n} of 9", { n: card.filter((k) => hits.has(k)).length })}</span>
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {card.map((k, i) => {
          const on = hits.has(k);
          const inLine = line?.includes(i);
          return (
            <div
              key={k}
              className={`relative flex aspect-square items-center justify-center rounded-2xl p-1.5 text-center text-[11px] leading-tight font-medium transition duration-500 ${
                inLine ? "bg-rose-500 text-snow shadow-[0_8px_20px_-8px_rgb(244_63_94/0.8)]" : on ? "bg-emerald-100 text-emerald-800" : "bg-stone-900/[0.04] text-stone-600"
              }`}
            >
              {on && <CheckIcon size={14} weight="bold" className="absolute top-1.5 right-1.5" aria-hidden="true" />}
              <span>{t(label.get(k) ?? k)}</span>
            </div>
          );
        })}
      </div>
      {(canClaim || done) && (
        <button className="btn-accent w-full" disabled={done} onClick={() => void claim()}>
          {done ? t("Bingo badge earned!") : t("Bingo! Claim your badge")}
        </button>
      )}
      {line && userId && !canClaim && !done && <p className="text-xs text-stone-500">{t("Checking your line...")}</p>}
      {!userId && <p className="text-xs text-stone-500">{t("Sign in to claim a badge when you get a line.")}</p>}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}
