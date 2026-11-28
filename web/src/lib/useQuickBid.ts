import { useState } from "react";
import { minNextBid } from "./bidding";
import { money } from "./format";
import { t } from "./i18n";
import { errorMessage, supabase } from "./supabase";
import type { Auction, BidResult, Lot } from "./types";

export interface QuickBidState {
  /** Places the minimum next bid on the lot. */
  bid: (lot: Lot) => Promise<void>;
  /** The lot a bid is being placed on right now. */
  busyId: string | null;
  /** The last result, for the lot it was about. */
  msg: { lotId: string; ok: boolean; text: string } | null;
}

/** One-tap minimum bids, for the phone bid bar and the lot list. */
export function useQuickBid(auction: Auction | null): QuickBidState {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<QuickBidState["msg"]>(null);

  async function bid(lot: Lot) {
    if (!auction) return;
    const amount = minNextBid(lot, auction.settings);
    setBusyId(lot.id);
    setMsg(null);
    const { data, error } = await supabase.rpc("place_bid", { p_lot_id: lot.id, p_amount: amount, p_max_amount: null });
    setBusyId(null);
    if (error) {
      const text = errorMessage(error);
      // Someone got in first: the price moved and the button now shows the new minimum.
      setMsg({ lotId: lot.id, ok: false, text: text.startsWith("Minimum bid is") ? t("Someone bid first. Tap again to bid the new minimum.") : text });
      return;
    }
    const res = data as BidResult;
    setMsg(
      res.status === "leading"
        ? { lotId: lot.id, ok: true, text: t("You're winning at {amount}", { amount: money(res.current_bid, auction.settings) }) }
        : { lotId: lot.id, ok: false, text: t("Outbid by an auto-bid. Current price {amount}", { amount: money(res.current_bid, auction.settings) }) },
    );
  }

  return { bid, busyId, msg };
}
