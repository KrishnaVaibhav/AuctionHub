import { useCallback, useEffect, useState } from "react";
import { supabase, errorMessage, channelName } from "./supabase";
import type { Auction, Lot, LotMedia } from "./types";

export interface AuctionRoomData {
  auction: Auction | null;
  lots: Lot[];
  media: Map<string, LotMedia[]>;
  moderatorIds: string[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/** Loads an auction with lots + media and keeps auction/lot rows live via Realtime. */
export function useAuctionRoom(auctionId: string | undefined): AuctionRoomData {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [media, setMedia] = useState<Map<string, LotMedia[]>>(new Map());
  const [moderatorIds, setModeratorIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!auctionId) return;
    const [a, l, m] = await Promise.all([
      supabase.from("auctions").select("*").eq("id", auctionId).maybeSingle(),
      supabase.from("lots").select("*").eq("auction_id", auctionId).order("position").order("created_at"),
      supabase.from("auction_moderators").select("user_id").eq("auction_id", auctionId),
    ]);
    if (a.error || l.error) {
      setError(errorMessage(a.error ?? l.error));
    } else {
      setError(null);
    }
    setAuction((a.data as Auction | null) ?? null);
    const lotRows = (l.data as Lot[] | null) ?? [];
    setLots(lotRows);
    setModeratorIds((m.data ?? []).map((r) => r.user_id as string));

    if (lotRows.length) {
      const { data } = await supabase
        .from("lot_media")
        .select("*")
        .in(
          "lot_id",
          lotRows.map((x) => x.id),
        )
        .order("position");
      const map = new Map<string, LotMedia[]>();
      for (const row of (data as LotMedia[] | null) ?? []) {
        map.set(row.lot_id, [...(map.get(row.lot_id) ?? []), row]);
      }
      setMedia(map);
    } else {
      setMedia(new Map());
    }
    setLoading(false);
  }, [auctionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!auctionId) return;
    const channel = supabase
      .channel(channelName(`room:${auctionId}`))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auctions", filter: `id=eq.${auctionId}` }, (p) =>
        setAuction((prev) => (prev ? { ...prev, ...(p.new as Auction) } : (p.new as Auction))),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "lots", filter: `auction_id=eq.${auctionId}` }, (p) => {
        if (p.eventType === "DELETE") {
          const oldId = (p.old as Partial<Lot>).id;
          setLots((prev) => prev.filter((x) => x.id !== oldId));
          return;
        }
        const row = p.new as Lot;
        setLots((prev) => {
          const i = prev.findIndex((x) => x.id === row.id);
          if (i === -1) return [...prev, row].sort((x, y) => x.position - y.position);
          const next = prev.slice();
          next[i] = { ...next[i], ...row };
          return next;
        });
      })
      .subscribe((status) => {
        // Re-sync after reconnects so no update is missed.
        if (status === "SUBSCRIBED") void reload();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [auctionId, reload]);

  return { auction, lots, media, moderatorIds, loading, error, reload };
}
