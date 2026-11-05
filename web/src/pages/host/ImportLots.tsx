import { useState } from "react";
import { supabase, errorMessage } from "../../lib/supabase";
import { CSV_TEMPLATE, LEAGUE_CSV_TEMPLATE, parseCsv, toLots, type ImportedLot } from "../../lib/csv";
import type { Auction } from "../../lib/types";

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Bulk-add lots (or league players) from a CSV file. */
export function ImportLots({ auction, nextPosition, onDone }: { auction: Auction; nextPosition: number; onDone: () => Promise<void> }) {
  const [preview, setPreview] = useState<ImportedLot[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const league = auction.mode === "league";

  async function read(file: File) {
    setMsg(null);
    if (file.size > 2 * 1024 * 1024) return setErrors(["File is too large (max 2 MB)."]);
    const { lots, errors } = toLots(parseCsv(await file.text()));
    if (lots.length > 500) return setErrors(["Up to 500 lots per import."]);
    setPreview(lots);
    setErrors(errors);
  }

  async function importAll() {
    if (!preview?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const rows = preview.map((l, i) => ({
        id: crypto.randomUUID(),
        auction_id: auction.id,
        position: nextPosition + i,
        title: l.title,
        description: l.description,
        start_price: l.start_price,
        buy_now_price: l.buy_now_price,
        custom_fields: l.custom_fields,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from("lots").insert(rows.slice(i, i + 100));
        if (error) throw error;
      }
      const reserves = preview.map((l, i) => ({ lot_id: rows[i].id, reserve_price: l.reserve_price })).filter((r) => r.reserve_price != null);
      if (reserves.length) {
        const { error } = await supabase.from("lot_reserves").insert(reserves);
        if (error) throw error;
      }
      setMsg(`Imported ${rows.length} ${league ? "players" : "lots"}.`);
      setPreview(null);
      setErrors([]);
      await onDone();
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 border-dashed p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">Import {league ? "players" : "lots"} from CSV</h3>
        <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => download(league ? "players-template.csv" : "lots-template.csv", league ? LEAGUE_CSV_TEMPLATE : CSV_TEMPLATE)}>
          Download template
        </button>
        <label className="btn-primary cursor-pointer py-1.5 text-xs">
          Choose CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) void read(e.target.files[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p className="text-xs text-stone-500">
        Columns: <code>{league ? "player, base_price" : "title, start_price"}</code>
        {league ? "" : ", optional buy_now_price, reserve_price, description"}. Any other column (e.g. {league ? "Role, Country" : "Condition, Year"}) becomes a detail on the {league ? "player" : "lot"}. Export from
        Excel or Google Sheets as CSV.
      </p>
      {errors.length > 0 && (
        <ul className="max-h-32 overflow-y-auto rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
          {errors.slice(0, 50).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="space-y-2">
          <p className="text-sm">
            Ready to import <strong>{preview.length}</strong> {league ? "players" : "lots"}
            {errors.length > 0 && ` (${errors.length} rows skipped)`}.
          </p>
          <ul className="max-h-40 divide-y divide-stone-900/[0.06] overflow-y-auto rounded-2xl bg-stone-900/[0.04] text-xs">
            {preview.slice(0, 50).map((l, i) => (
              <li key={i} className="flex justify-between gap-2 px-3 py-1.5">
                <span className="truncate">{l.title}</span>
                <span className="shrink-0 tabular-nums text-stone-500">{l.start_price.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="btn-accent" disabled={busy || preview.length === 0} onClick={() => void importAll()}>
              {busy ? "Importing..." : `Import ${preview.length}`}
            </button>
            <button className="btn-ghost" onClick={() => (setPreview(null), setErrors([]))}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-stone-600">{msg}</p>}
    </div>
  );
}
