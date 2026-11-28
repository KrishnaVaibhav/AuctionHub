import { useEffect } from "react";
import { serverNow, syncServerClock } from "./clock";
import { supabase } from "./supabase";
import type { Auction, Lot } from "./types";

const HOUR = 3_600_000;

/**
 * When a lot's clock reaches zero, ask the server to close it now. The
 * scheduler would close it anyway, but only on its next run (up to 15 seconds
 * later); this way the room shows "Sold" the moment time is up. The server
 * only closes lots whose time really is up (close_due_lots), so a fast or
 * skewed clock here can't end a lot early.
 */
export function useCloseDue(auction: Auction | null, lots: Lot[]): void {
  const auctionId = auction?.id;
  const live = auction?.status === "live" && auction.mode !== "league";
  let next: number | null = null;
  if (live) {
    for (const l of lots) {
      if (l.status !== "open" || !l.ends_at) continue;
      const at = new Date(l.ends_at).getTime();
      if (next == null || at < next) next = at;
    }
  }

  useEffect(() => {
    if (!auctionId || next == null) return;
    const due = next;
    let timer = 0;
    let stopped = false;
    let tries = 0;
    const ask = () => {
      if (stopped) return;
      void supabase.rpc("close_due_lots", { p_auction_id: auctionId });
      // Still open a moment later (a busy server, a slow clock)? Ask again a few times.
      if (++tries < 5) timer = window.setTimeout(ask, 3000);
    };
    const arm = () => {
      if (stopped) return;
      const wait = due - serverNow();
      // Long waits are re-armed hourly: timers can't hold more than ~24 days.
      if (wait > HOUR) timer = window.setTimeout(arm, HOUR);
      // A little jitter, so a full room doesn't ask at the same millisecond.
      else timer = window.setTimeout(ask, Math.max(0, wait) + 300 + Math.random() * 700);
    };
    void syncServerClock().then(arm);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [auctionId, next]);
}
