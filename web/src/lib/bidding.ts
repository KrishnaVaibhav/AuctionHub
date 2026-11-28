import type { AuctionSettings, Lot } from "./types";

// Mirrors public.bid_increment() in supabase/migrations. The server is the
// source of truth; this is only used to pre-fill and validate the bid form.
export const DEFAULT_INCREMENTS: [number, number][] = [
  [0, 10],
  [1000, 50],
  [5000, 100],
  [10000, 500],
  [50000, 1000],
  [100000, 5000],
];

export function bidIncrement(amount: number, settings?: AuctionSettings): number {
  const table = settings?.increments?.length ? settings.increments : DEFAULT_INCREMENTS;
  let inc = 1;
  let best = -Infinity;
  for (const [threshold, step] of table) {
    if (threshold <= amount && threshold > best) {
      best = threshold;
      inc = step;
    }
  }
  return inc;
}

/** Mirrors public.min_next_bid(): a lot that starts at 0 takes one increment as its first bid. */
export function minNextBid(lot: Pick<Lot, "current_bid" | "start_price">, settings?: AuctionSettings): number {
  if (lot.current_bid == null) {
    const start = Number(lot.start_price);
    return start > 0 ? start : bidIncrement(0, settings);
  }
  const current = Number(lot.current_bid);
  return round2(current + bidIncrement(current, settings));
}

/**
 * A typed bid well above the minimum (twice it, and at least five steps more)
 * is probably a slip, like an extra zero. The bid form asks before placing it.
 */
export function looksLikeTypo(amount: number, min: number, step: number): boolean {
  return amount >= min * 2 && amount - min >= step * 5;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
