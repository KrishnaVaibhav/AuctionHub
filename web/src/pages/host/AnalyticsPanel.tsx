import { useEffect, useState } from "react";
import { supabase, errorMessage } from "../../lib/supabase";
import { money } from "../../lib/format";
import type { Auction } from "../../lib/types";
import { LotBadge } from "../../components/StatusBadge";

interface Analytics {
  lots: number;
  lots_sold: number;
  sold_total: number;
  start_total: number;
  bids: number;
  manual_bids: number;
  unique_bidders: number;
  watchers: number;
  chat_messages: number;
  chatters: number;
  members: number;
  per_lot: { id: string; position: number; title: string; status: "pending" | "open" | "sold" | "unsold" | "withdrawn"; start: number; final: number | null; bids: number; bidders: number; watchers: number; uplift_pct: number | null }[];
  timeline: { t: string; bids: number }[];
  top_bidders: { name: string; bids: number; won: number }[];
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-stone-50 p-3">
      <p className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">{label}</p>
      <p className="mt-0.5 truncate font-display text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-stone-500">{sub}</p>}
    </div>
  );
}

function exportCsv(auction: Auction, d: Analytics) {
  const rows = [["#", "Lot", "Status", "Start", "Final", "Bids", "Bidders", "Watchers", "Uplift %"]].concat(
    d.per_lot.map((l) => [String(l.position + 1), l.title, l.status, String(l.start), String(l.final ?? ""), String(l.bids), String(l.bidders), String(l.watchers), String(l.uplift_pct ?? "")]),
  );
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${auction.title.replace(/[^\w-]+/g, "_")}_analytics.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Per-auction analytics for the host: engagement, conversion, per-lot performance, bid timeline. */
export function AnalyticsPanel({ auction }: { auction: Auction }) {
  const [d, setD] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.rpc("auction_analytics", { p_auction_id: auction.id }).then(({ data, error }) => {
      if (error) setError(errorMessage(error));
      else setD(data as Analytics);
    });
  }, [auction.id, auction.status]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />;

  const s = auction.settings;
  const conversion = d.lots ? Math.round((d.lots_sold / d.lots) * 100) : 0;
  const uplift = d.start_total ? Math.round(((d.sold_total - d.start_total) / d.start_total) * 100) : 0;
  const peak = Math.max(1, ...d.timeline.map((t) => t.bids));

  return (
    <section className="card space-y-5 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Analytics</h2>
        <button className="btn-ghost py-1.5 text-xs" onClick={() => exportCsv(auction, d)}>
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Sold" value={`${d.lots_sold}/${d.lots}`} sub={`${conversion}% conversion`} />
        <Stat label="Revenue" value={money(d.sold_total, s)} sub={d.start_total ? `${uplift >= 0 ? "+" : ""}${uplift}% over start prices` : undefined} />
        <Stat label="Bidders" value={d.unique_bidders} sub={`${d.bids} bids (${d.manual_bids} manual)`} />
        <Stat label="Engagement" value={d.watchers} sub={`watchers · ${d.chatters} chatters · ${d.chat_messages} messages`} />
      </div>

      {d.timeline.length > 0 && (
        <div>
          <p className="label">Bids over time</p>
          <div className="flex h-24 items-end gap-0.5 overflow-x-auto rounded-xl bg-stone-50 p-2" role="img" aria-label="Bids per minute">
            {d.timeline.map((t) => (
              <div
                key={t.t}
                title={`${new Date(t.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${t.bids} bids`}
                className="w-2 shrink-0 rounded-t bg-brand-500"
                style={{ height: `${(t.bids / peak) * 100}%` }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-[11px] tracking-wider text-stone-500 uppercase">
            <tr>
              <th className="py-2">Lot</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Start</th>
              <th className="py-2 text-right">Final</th>
              <th className="py-2 text-right">Bids</th>
              <th className="py-2 text-right">Bidders</th>
              <th className="py-2 text-right">Watchers</th>
              <th className="py-2 text-right">Uplift</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {d.per_lot.map((l) => (
              <tr key={l.id}>
                <td className="max-w-48 truncate py-2">
                  <span className="mr-1 text-stone-400">#{l.position + 1}</span>
                  {l.title}
                </td>
                <td className="py-2">
                  <LotBadge status={l.status} />
                </td>
                <td className="py-2 text-right tabular-nums">{money(l.start, s)}</td>
                <td className="py-2 text-right tabular-nums">{l.final != null ? money(l.final, s) : "-"}</td>
                <td className="py-2 text-right tabular-nums">{l.bids}</td>
                <td className="py-2 text-right tabular-nums">{l.bidders}</td>
                <td className="py-2 text-right tabular-nums">{l.watchers}</td>
                <td className="py-2 text-right tabular-nums">{l.uplift_pct != null ? `${l.uplift_pct}%` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d.top_bidders.length > 0 && (
        <div>
          <p className="label">Most active bidders</p>
          <ul className="divide-y divide-stone-100 text-sm">
            {d.top_bidders.map((b, i) => (
              <li key={i} className="flex justify-between py-1.5">
                <span>{b.name}</span>
                <span className="text-stone-500">
                  {b.bids} bids · won {b.won}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
