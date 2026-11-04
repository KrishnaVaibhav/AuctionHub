import type { Lot } from "./types";

export type SaleType = "english" | "dutch" | "sealed" | "offer";

export const SALE_TYPES: { value: SaleType; label: string; help: string }[] = [
  { value: "english", label: "Standard bidding", help: "Bids go up. Auto-bid and anti-snipe apply." },
  { value: "dutch", label: "Dutch (price drops)", help: "The price falls on a timer. The first person to accept buys." },
  { value: "sealed", label: "Sealed bid", help: "Bids stay hidden until the lot closes. Highest bid wins." },
  { value: "offer", label: "Make an offer", help: "Bidders send offers. You accept or decline each one." },
];

export interface DutchSettings {
  step: number;
  floor: number;
  interval_s: number;
}

export function dutchSettings(lot: Pick<Lot, "sale_settings">): DutchSettings {
  const s = (lot.sale_settings ?? {}) as Partial<Record<keyof DutchSettings, number | string>>;
  return { step: Number(s.step ?? 0), floor: Number(s.floor ?? 0), interval_s: Math.max(5, Number(s.interval_s ?? 60)) };
}

/** Mirrors public._dutch_price: start minus one step per elapsed interval, never below the floor. */
export function dutchPrice(lot: Pick<Lot, "start_price" | "opens_at" | "sale_settings">, nowMs: number, pausedAt?: string | null): number {
  const s = dutchSettings(lot);
  const t = pausedAt ? new Date(pausedAt).getTime() : nowMs;
  const opened = lot.opens_at ? new Date(lot.opens_at).getTime() : t;
  const steps = Math.max(0, Math.floor((t - opened) / 1000 / s.interval_s));
  return Math.max(s.floor, Number(lot.start_price) - s.step * steps);
}

/** Milliseconds until the next Dutch price drop (0 once the floor is reached). */
export function nextDropIn(lot: Pick<Lot, "start_price" | "opens_at" | "sale_settings">, nowMs: number): number {
  const s = dutchSettings(lot);
  if (dutchPrice(lot, nowMs) <= s.floor) return 0;
  const opened = lot.opens_at ? new Date(lot.opens_at).getTime() : nowMs;
  const period = s.interval_s * 1000;
  return period - ((nowMs - opened) % period);
}
