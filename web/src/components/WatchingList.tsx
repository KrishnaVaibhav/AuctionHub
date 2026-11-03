import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase } from "../lib/supabase";
import { money } from "../lib/format";
import type { AuctionSettings, AuctionStatus, LotStatus } from "../lib/types";
import { Countdown } from "./Countdown";
import { LotBadge } from "./StatusBadge";
import { WatchButton } from "./WatchButton";

interface Row {
  lot_id: string;
  lots: {
    id: string;
    title: string;
    status: LotStatus;
    current_bid: number | null;
    start_price: number;
    ends_at: string | null;
    auction_id: string;
    auctions: { title: string; settings: AuctionSettings; status: AuctionStatus } | null;
  } | null;
}

export function WatchingList({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    void supabase
      .from("watchlist")
      .select("lot_id, lots(id, title, status, current_bid, start_price, ends_at, auction_id, auctions(title, settings, status))")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data as unknown as Row[] | null) ?? []));
  }, [userId]);

  if (rows === null) return <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />;
  const visible = rows.filter((r) => r.lots);
  if (visible.length === 0) {
    return (
      <div className="card py-14 text-center">
        <p className="font-semibold">Nothing on your watchlist</p>
        <p className="mt-1 text-sm text-stone-500">Tap the star on any lot to keep an eye on it.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {visible.map(({ lots: l }) => (
        <div key={l!.id} className="card flex animate-rise items-center gap-3 p-4">
          <Link to={`/a/${l!.auction_id}`} className="min-w-0 flex-1">
            <p className="truncate text-xs text-stone-500">{l!.auctions?.title}</p>
            <p className="truncate font-semibold">{l!.title}</p>
            <div className="mt-1 flex items-center gap-2 text-sm">
              <span className="font-bold tabular-nums">{money(l!.current_bid ?? l!.start_price, l!.auctions?.settings)}</span>
              <LotBadge status={l!.status} />
              {l!.status === "open" && l!.auctions?.status === "live" && <Countdown endsAt={l!.ends_at} className="text-xs" />}
            </div>
          </Link>
          <WatchButton lotId={l!.id} userId={userId} compact />
        </div>
      ))}
    </div>
  );
}
