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

export function minNextBid(lot: Pick<Lot, "current_bid" | "start_price">, settings?: AuctionSettings): number {
  if (lot.current_bid == null) return Number(lot.start_price);
  const current = Number(lot.current_bid);
  return round2(current + bidIncrement(current, settings));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
