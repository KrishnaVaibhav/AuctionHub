import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/format";
import { useProfileNames } from "../lib/profiles";
import type { Auction, Bid, Lot } from "../lib/types";
import { Avatar } from "./Avatar";

const PAGE = 50;

/** Every bid in the auction, newest first, with lot + bidder filters. */
export function BidLog({ auction, lots, userId }: { auction: Auction; lots: Lot[]; userId: string | null }) {
  const [bids, setBids] = useState<Bid[]>([]);
  const [lotFilter, setLotFilter] = useState<string>("all");
  const [showAuto, setShowAuto] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const totalBids = lots.reduce((n, l) => n + l.bid_count, 0);
  const lotTitle = useMemo(() => new Map(lots.map((l) => [l.id, `#${l.position + 1} ${l.title}`])), [lots]);
  const winners = useMemo(() => new Map(lots.map((l) => [l.id, l.current_winner_id])), [lots]);
  const names = useProfileNames(bids.map((b) => b.bidder_id));

  async function fetchPage(offset: number): Promise<Bid[]> {
    let q = supabase
      .from("bids")
      .select("id, lot_id, bidder_id, amount, is_auto, created_at, lots!inner(auction_id)")
      .eq("lots.auction_id", auction.id)
      .order("id", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (lotFilter !== "all") q = q.eq("lot_id", lotFilter);
    if (!showAuto) q = q.eq("is_auto", false);
    const { data } = await q;
    return (data as unknown as Bid[] | null) ?? [];
  }

  // Reload the first page when filters change or any new bid lands.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchPage(0).then((rows) => {
      if (cancelled) return;
      setBids(rows);
      setHasMore(rows.length === PAGE);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [auction.id, lotFilter, showAuto, totalBids]);

  async function more() {
    const rows = await fetchPage(bids.length);
    setBids((prev) => [...prev, ...rows]);
    setHasMore(rows.length === PAGE);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 p-4">
        <h2 className="mr-auto font-semibold">
          Bid log <span className="text-sm font-normal text-stone-400">· {totalBids} bids</span>
        </h2>
        <select className="input w-auto py-1.5" value={lotFilter} onChange={(e) => setLotFilter(e.target.value)}>
          <option value="all">All lots</option>
          {lots.map((l) => (
            <option key={l.id} value={l.id}>
              {lotTitle.get(l.id)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-stone-600">
          <input type="checkbox" checked={showAuto} onChange={(e) => setShowAuto(e.target.checked)} />
          Auto-bids
        </label>
      </div>

      {bids.length === 0 && !loading ? (
        <p className="p-6 text-center text-sm text-stone-500">No bids yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {bids.map((b) => {
            const name = b.bidder_id === userId ? "You" : (names.get(b.bidder_id) ?? "Bidder");
            const isTop = winners.get(b.lot_id) === b.bidder_id && bids.find((x) => x.lot_id === b.lot_id)?.id === b.id;
            return (
              <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={names.get(b.bidder_id)} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    <span className="font-semibold">{name}</span>
                    {b.is_auto && <span className="chip ml-1.5 bg-stone-100 px-1.5 text-[10px] text-stone-500">AUTO</span>}
                    {isTop && <span className="chip ml-1.5 bg-emerald-100 px-1.5 text-[10px] text-emerald-800">TOP</span>}
                  </p>
                  <p className="truncate text-xs text-stone-500">
                    {lotTitle.get(b.lot_id)} · {new Date(b.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{money(b.amount, auction.settings)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className="border-t border-stone-100 p-3 text-center">
          <button className="btn-ghost" onClick={() => void more()}>
            Load older bids
          </button>
        </div>
      )}
    </div>
  );
}
