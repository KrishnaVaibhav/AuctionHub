import { useEffect, useState } from "react";
import { supabase, errorMessage } from "../lib/supabase";
import { money } from "../lib/format";
import { useProfileNames } from "../lib/profiles";
import type { Auction, Lot, LotStatus } from "../lib/types";
import { LotBadge } from "./StatusBadge";
import { Avatar } from "./Avatar";
import { DealChat } from "./DealChat";

interface HostRow {
  lot_id: string;
  position: number;
  title: string;
  status: LotStatus;
  final_price: number | null;
  bid_count: number;
  reserve_met: boolean;
  winner_id: string | null;
  winner_name: string | null;
  winner_username: string | null;
  winner_email: string | null;
  winner_phone: string | null;
  winner_note: string | null;
  closed_at: string | null;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Per-lot outcome. Everyone sees winner + price; the host also sees the winner's email and can export CSV. */
export function Results({ auction, lots, isHost, userId }: { auction: Auction; lots: Lot[]; isHost: boolean; userId: string | null }) {
  const [hostRows, setHostRows] = useState<HostRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<Lot | null>(null);
  const names = useProfileNames(lots.map((l) => l.current_winner_id));
  const closedKey = lots.map((l) => `${l.id}:${l.status}:${l.current_bid}`).join("|");

  useEffect(() => {
    if (!isHost) return;
    void supabase.rpc("auction_results", { p_auction_id: auction.id }).then(({ data, error }) => {
      if (error) setError(errorMessage(error));
      else setHostRows(data as HostRow[]);
    });
  }, [isHost, auction.id, closedKey]);

  const sold = lots.filter((l) => l.status === "sold");
  const total = sold.reduce((n, l) => n + Number(l.current_bid ?? 0), 0);
  const bids = lots.reduce((n, l) => n + l.bid_count, 0);
  const open = lots.filter((l) => l.status === "open" || l.status === "pending").length;

  function exportCsv() {
    if (!hostRows) return;
    const header = ["Lot", "Title", "Status", "Final price", "Currency", "Bids", "Winner", "Username", "Email (if shared)", "Phone (if shared)", "Note", "Closed at"];
    const lines = hostRows.map((r) =>
      [r.position + 1, r.title, r.status, r.final_price ?? "", auction.settings.currency ?? "INR", r.bid_count, r.winner_name ?? "", r.winner_username ?? "", r.winner_email ?? "", r.winner_phone ?? "", r.winner_note ?? "", r.closed_at ?? ""]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${auction.title.replace(/[^\w-]+/g, "_")}_results.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const hostById = new Map((hostRows ?? []).map((r) => [r.lot_id, r]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sold" value={`${sold.length} / ${lots.length}`} />
        <Stat label="Total sales" value={money(total, auction.settings)} />
        <Stat label="Bids" value={String(bids)} />
        <Stat label="Still open" value={String(open)} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-100 p-4">
          <h2 className="font-semibold">Results by lot</h2>
          {isHost && (
            <button className="btn-ghost py-1.5" onClick={exportCsv} disabled={!hostRows}>
              Export CSV
            </button>
          )}
        </div>
        <ul className="divide-y divide-stone-100">
          {lots.map((l) => {
            const h = hostById.get(l.id);
            const winnerName = userId && l.current_winner_id === userId ? "You" : l.current_winner_id ? (names.get(l.current_winner_id) ?? "...") : null;
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-8 font-mono text-xs text-stone-400">#{l.position + 1}</span>
                <div className="min-w-[10rem] flex-1">
                  <p className="truncate font-medium">{l.title}</p>
                  <p className="text-xs text-stone-500">
                    {l.bid_count} bid{l.bid_count === 1 ? "" : "s"}
                    {!l.reserve_met && l.current_winner_id && " · reserve not met"}
                  </p>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {winnerName && (
                    <>
                      <Avatar name={l.current_winner_id ? names.get(l.current_winner_id) : null} size={26} />
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">
                          {l.status === "sold" ? "Won by " : "Leading: "}
                          {winnerName}
                        </p>
                        {isHost && l.status === "sold" && (h?.winner_email || h?.winner_phone) && (
                          <p className="truncate text-xs text-sky-700">
                            {[h.winner_email, h.winner_phone, h.winner_note].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{money(l.current_bid ?? l.start_price, auction.settings)}</span>
                  <LotBadge status={l.status} />
                  {isHost && userId && l.status === "sold" && l.current_winner_id && (
                    <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setDeal(l)}>
                      Message
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {isHost && (
        <p className="text-xs text-stone-500">
          Winner contact details appear only if the winner chose to share them. You can always use "Message" for a private deal chat.
        </p>
      )}
      {deal && userId && (
        <DealChat
          lotId={deal.id}
          lotTitle={deal.title}
          userId={userId}
          otherName={(deal.current_winner_id && names.get(deal.current_winner_id)) || "the winner"}
          onClose={() => setDeal(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">{label}</p>
      <p className="mt-1 truncate font-display text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
