import { auctionStatusLabel, lotStatusLabel } from "../lib/format";
import type { AuctionStatus, LotStatus } from "../lib/types";

const auctionColors: Record<AuctionStatus, string> = {
  draft: "bg-stone-100 text-stone-600",
  scheduled: "bg-sky-100 text-sky-800",
  live: "bg-red-600 text-snow",
  paused: "bg-amber-100 text-amber-800",
  ended: "bg-stone-200 text-stone-700",
  cancelled: "bg-stone-100 text-stone-400 line-through",
};

const lotColors: Record<LotStatus, string> = {
  pending: "bg-stone-100 text-stone-600",
  open: "bg-emerald-100 text-emerald-800",
  sold: "bg-stone-900 text-white",
  unsold: "bg-stone-200 text-stone-600",
  withdrawn: "bg-stone-100 text-stone-400",
};

export function AuctionBadge({ status }: { status: AuctionStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${auctionColors[status]}`}>
      {status === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-snow" />}
      {auctionStatusLabel[status]}
    </span>
  );
}

export function LotBadge({ status }: { status: LotStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${lotColors[status]}`}>
      {lotStatusLabel[status]}
    </span>
  );
}
