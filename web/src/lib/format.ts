import type { AuctionSettings, AuctionStatus, LotStatus } from "./types";

export function money(amount: number | null | undefined, settings?: AuctionSettings): string {
  if (amount == null) return "-";
  const currency = settings?.currency ?? "INR";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "2d 4h", "1h 5m", "4:09" style remaining time. */
export function remaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** ISO string to the value format of <input type="datetime-local">. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export const auctionStatusLabel: Record<AuctionStatus, string> = {
  draft: "Draft",
  scheduled: "Upcoming",
  live: "Live",
  paused: "Paused",
  ended: "Ended",
  cancelled: "Cancelled",
};

export const lotStatusLabel: Record<LotStatus, string> = {
  pending: "Not open",
  open: "Open",
  sold: "Sold",
  unsold: "Unsold",
  withdrawn: "Withdrawn",
};

/** "0:10, 1000:50" <-> [[0,10],[1000,50]] for the increment table editor. */
export function parseIncrements(text: string): [number, number][] | null {
  const rows = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => pair.split(":").map((n) => Number(n.trim())));
  if (rows.length === 0) return null;
  if (rows.some((r) => r.length !== 2 || r.some((n) => !Number.isFinite(n) || n < 0) || r[1] <= 0)) return null;
  return rows.map((r) => [r[0], r[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
}

export function formatIncrements(rows: [number, number][] | undefined): string {
  return (rows ?? []).map(([t, i]) => `${t}:${i}`).join(", ");
}
