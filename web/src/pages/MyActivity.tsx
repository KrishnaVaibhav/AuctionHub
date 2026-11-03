import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase, errorMessage } from "../lib/supabase";
import { money } from "../lib/format";
import { useProfileNames } from "../lib/profiles";
import type { LotStatus, AuctionStatus } from "../lib/types";
import { LotBadge } from "../components/StatusBadge";
import { Countdown } from "../components/Countdown";

interface MyLot {
  lot_id: string;
  auction_id: string;
  auction_title: string;
  auction_status: AuctionStatus;
  currency: string;
  host_id: string;
  title: string;
  status: LotStatus;
  current_bid: number;
  my_top_bid: number;
  my_max: number | null;
  is_leader: boolean;
  ends_at: string | null;
  last_bid_at: string;
}

type Tab = "active" | "won" | "lost";

export function MyActivity() {
  const [rows, setRows] = useState<MyLot[]>([]);
  const [tab, setTab] = useState<Tab>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hosts = useProfileNames(rows.map((r) => r.host_id));

  useEffect(() => {
    void supabase.rpc("my_lots").then(({ data, error }) => {
      if (error) setError(errorMessage(error));
      setRows((data as MyLot[] | null) ?? []);
      setLoading(false);
    });
  }, []);

  const active = rows.filter((r) => r.status === "open" || r.status === "pending");
  const won = rows.filter((r) => r.status === "sold" && r.is_leader);
  const lost = rows.filter((r) => !(r.status === "open" || r.status === "pending") && !(r.status === "sold" && r.is_leader));
  const lists: Record<Tab, MyLot[]> = { active, won, lost };
  const spent = won.reduce((n, r) => n + Number(r.current_bid), 0);
  const winningNow = active.filter((r) => r.is_leader).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">My bids & wins</h1>
        <p className="mt-1 text-sm text-stone-500">Everything you've bid on, what you're winning, and what you've won.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Winning now" value={`${winningNow} / ${active.length}`} accent />
        <Stat label="Won" value={String(won.length)} />
        <Stat label="Won total" value={won.length ? money(spent, { currency: won[0].currency }) : "-"} />
      </div>

      <div className="inline-flex gap-1 rounded-xl bg-stone-100 p-1">
        {(["active", "won", "lost"] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
            {t === "active" ? "Active" : t === "won" ? "Won" : "Not won"}
            <span className="ml-1.5 text-xs text-stone-400">{lists[t].length}</span>
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />}

      {!loading && lists[tab].length === 0 && (
        <div className="card py-14 text-center">
          <p className="font-semibold">{tab === "won" ? "No wins yet" : tab === "active" ? "No active bids" : "Nothing here"}</p>
          <Link to="/" className="btn-primary mt-4">
            Find an auction
          </Link>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {lists[tab].map((r) => {
          const cur = { currency: r.currency };
          return (
            <Link key={r.lot_id} to={`/a/${r.auction_id}`} className="card animate-rise p-4 transition hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs text-stone-500">{r.auction_title}</p>
                  <p className="truncate font-semibold">{r.title}</p>
                </div>
                {r.status === "open" ? (
                  <span className={`chip ${r.is_leader ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>
                    {r.is_leader ? "Winning" : "Outbid"}
                  </span>
                ) : r.status === "sold" && r.is_leader ? (
                  <span className="chip bg-brand-400 text-stone-950">You won</span>
                ) : (
                  <LotBadge status={r.status} />
                )}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-[11px] text-stone-500 uppercase">{r.status === "sold" ? "Final" : "Current"}</p>
                  <p className="font-bold tabular-nums">{money(r.current_bid, cur)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-stone-500 uppercase">Your top bid</p>
                  <p className="font-medium tabular-nums">{money(r.my_top_bid, cur)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-stone-500 uppercase">{r.status === "open" ? "Ends in" : "Auto-bid max"}</p>
                  <p className="font-medium tabular-nums">
                    {r.status === "open" && r.auction_status === "live" ? <Countdown endsAt={r.ends_at} /> : r.my_max ? money(r.my_max, cur) : "-"}
                  </p>
                </div>
              </div>
              {r.status === "sold" && r.is_leader && (
                <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
                  The host ({hosts.get(r.host_id) ?? "..."}) will contact you by email to arrange payment and delivery.
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 ${accent ? "bg-stone-900 text-white" : "card"}`}>
      <p className={`text-[11px] font-semibold tracking-wider uppercase ${accent ? "text-stone-400" : "text-stone-500"}`}>{label}</p>
      <p className="mt-1 truncate font-display text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
    </div>
  );
}
