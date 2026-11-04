import { useEffect, useState, type FormEvent } from "react";
import { supabase, errorMessage } from "../../lib/supabase";
import { deleteMedia, publicUrl, uploadMedia } from "../../lib/media";
import { money } from "../../lib/format";
import type { Auction, Lot, LotMedia } from "../../lib/types";
import { LotBadge } from "../../components/StatusBadge";
import { PriceHint } from "../../components/PriceHint";
import { confirmDialog } from "../../lib/confirm";
import { SALE_TYPES, dutchSettings, type SaleType } from "../../lib/saleTypes";

function parseFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k && v) out[k.slice(0, 40)] = v.slice(0, 200);
    }
  }
  return out;
}

function formatFields(fields: Record<string, string> | null | undefined): string {
  return Object.entries(fields ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));

interface LotFields {
  title: string;
  description: string;
  startPrice: string;
  buyNow: string;
  reserve: string;
  fields: string;
  saleType: SaleType;
  dutchStep: string;
  dutchFloor: string;
  dutchInterval: string;
}

function LotFieldInputs({ v, set, disabled, league }: { v: LotFields; set: (v: LotFields) => void; disabled?: boolean; league?: boolean }) {
  const help = SALE_TYPES.find((t) => t.value === v.saleType)?.help;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {!league && (
        <div className="sm:col-span-3">
          <label className="label" htmlFor="sale-type">
            Sale type
          </label>
          <select id="sale-type" className="input" disabled={disabled} value={v.saleType} onChange={(e) => set({ ...v, saleType: e.target.value as SaleType })}>
            {SALE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {help && <p className="mt-1 text-xs text-stone-500">{help}</p>}
        </div>
      )}
      {v.saleType === "dutch" && (
        <>
          <div>
            <label className="label">Drop by</label>
            <input className="input" type="number" min={0.01} step="0.01" required disabled={disabled} value={v.dutchStep} onChange={(e) => set({ ...v, dutchStep: e.target.value })} />
          </div>
          <div>
            <label className="label">Every (seconds)</label>
            <input className="input" type="number" min={5} max={3600} step={1} required disabled={disabled} value={v.dutchInterval} onChange={(e) => set({ ...v, dutchInterval: e.target.value })} />
          </div>
          <div>
            <label className="label">Floor price</label>
            <input className="input" type="number" min={0.01} step="0.01" required disabled={disabled} value={v.dutchFloor} onChange={(e) => set({ ...v, dutchFloor: e.target.value })} />
          </div>
        </>
      )}
      <div className="sm:col-span-3">
        <label className="label">Title</label>
        <input className="input" required maxLength={120} disabled={disabled} value={v.title} onChange={(e) => set({ ...v, title: e.target.value })} />
      </div>
      <div>
        <label className="label">{v.saleType === "offer" ? "Minimum offer" : v.saleType === "dutch" ? "Opening price" : "Start price"}</label>
        <input
          className="input"
          type="number"
          min={0}
          step="0.01"
          required
          disabled={disabled}
          value={v.startPrice}
          onChange={(e) => set({ ...v, startPrice: e.target.value })}
        />
      </div>
      <div>
        <label className="label">Reserve (secret, optional)</label>
        <input className="input" type="number" min={0} step="0.01" disabled={disabled} value={v.reserve} onChange={(e) => set({ ...v, reserve: e.target.value })} />
      </div>
      <div>
        <label className="label">Buy now (optional)</label>
        <input className="input" type="number" min={0} step="0.01" disabled={disabled} value={v.buyNow} onChange={(e) => set({ ...v, buyNow: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Description</label>
        <textarea
          className="input min-h-20"
          maxLength={5000}
          disabled={disabled}
          value={v.description}
          onChange={(e) => set({ ...v, description: e.target.value })}
        />
      </div>
      <div>
        <label className="label">Details (one "key: value" per line)</label>
        <textarea
          className="input min-h-20 font-mono text-xs"
          placeholder={"Condition: Used\nYear: 1972"}
          disabled={disabled}
          value={v.fields}
          onChange={(e) => set({ ...v, fields: e.target.value })}
        />
      </div>
    </div>
  );
}

function validate(v: LotFields): string | null {
  const start = Number(v.startPrice);
  if (!Number.isFinite(start) || start < 0) return "Start price must be 0 or more";
  if (v.saleType === "dutch") {
    const step = Number(v.dutchStep);
    const floor = Number(v.dutchFloor);
    const every = Number(v.dutchInterval);
    if (!(step > 0)) return "Drop amount must be more than 0";
    if (!(every >= 5 && every <= 3600)) return "Drop interval must be 5 to 3600 seconds";
    if (!(floor > 0 && floor < start)) return "Floor price must be above 0 and below the opening price";
  }
  if ((v.saleType === "dutch" || v.saleType === "sealed") && v.buyNow.trim() !== "") return "Buy now is only for standard and offer lots";
  const buy = num(v.buyNow);
  if (buy != null && !(buy > start)) return "Buy now price must be higher than the start price";
  const reserve = num(v.reserve);
  if (reserve != null && !(reserve > 0)) return "Reserve must be more than 0";
  return null;
}

function saleColumns(v: LotFields) {
  return {
    sale_type: v.saleType,
    sale_settings:
      v.saleType === "dutch" ? { step: Number(v.dutchStep), floor: Number(v.dutchFloor), interval_s: Math.round(Number(v.dutchInterval)) } : {},
  };
}

async function saveReserve(lotId: string, reserve: number | null) {
  const res =
    reserve == null
      ? await supabase.from("lot_reserves").delete().eq("lot_id", lotId)
      : await supabase.from("lot_reserves").upsert({ lot_id: lotId, reserve_price: reserve });
  if (res.error) throw res.error;
}

export function NewLotForm({ auction, nextPosition, onCreated }: { auction: Auction; nextPosition: number; onCreated: () => Promise<void> }) {
  const empty: LotFields = {
    title: "",
    description: "",
    startPrice: "",
    buyNow: "",
    reserve: "",
    fields: "",
    saleType: "english",
    dutchStep: "",
    dutchFloor: "",
    dutchInterval: "60",
  };
  const [v, setV] = useState<LotFields>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    const invalid = validate(v);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("lots")
        .insert({
          auction_id: auction.id,
          position: nextPosition,
          title: v.title.trim(),
          description: v.description,
          start_price: Number(v.startPrice),
          buy_now_price: num(v.buyNow),
          custom_fields: parseFields(v.fields),
          ...saleColumns(v),
        })
        .select("id")
        .single();
      if (error) throw error;
      await saveReserve(data.id, num(v.reserve));
      setV(empty);
      await onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="card space-y-4 border-dashed p-5">
      <h3 className="font-semibold">Add a lot</h3>
      <LotFieldInputs v={v} set={setV} league={auction.mode === "league"} />
      {auction.mode !== "league" && <PriceHint category={auction.category} title={v.title} settings={auction.settings} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary" disabled={busy}>
        Add lot
      </button>
    </form>
  );
}

interface EditorProps {
  auction: Auction;
  lot: Lot;
  index: number;
  total: number;
  siblings: Lot[];
  media: LotMedia[];
  editable: boolean;
  onChange: () => Promise<void>;
}

export function LotEditor({ auction, lot, index, total, siblings, media, editable, onChange }: EditorProps) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<LotFields>({
    title: lot.title,
    description: lot.description,
    startPrice: String(lot.start_price),
    buyNow: lot.buy_now_price != null ? String(lot.buy_now_price) : "",
    reserve: "",
    fields: formatFields(lot.custom_fields),
    saleType: lot.sale_type ?? "english",
    dutchStep: lot.sale_type === "dutch" ? String(dutchSettings(lot).step) : "",
    dutchFloor: lot.sale_type === "dutch" ? String(dutchSettings(lot).floor) : "",
    dutchInterval: lot.sale_type === "dutch" ? String(dutchSettings(lot).interval_s) : "60",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void supabase
      .from("lot_reserves")
      .select("reserve_price")
      .eq("lot_id", lot.id)
      .maybeSingle()
      .then(({ data }) => setV((prev) => ({ ...prev, reserve: data ? String(data.reserve_price) : "" })));
  }, [open, lot.id]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    const invalid = validate(v);
    if (invalid) return setError(invalid);
    void run(async () => {
      const { error } = await supabase
        .from("lots")
        .update({
          title: v.title.trim(),
          description: v.description,
          start_price: Number(v.startPrice),
          buy_now_price: num(v.buyNow),
          custom_fields: parseFields(v.fields),
          ...saleColumns(v),
        })
        .eq("id", lot.id);
      if (error) throw error;
      await saveReserve(lot.id, num(v.reserve));
      setOpen(false);
    });
  };

  const move = (dir: -1 | 1) =>
    run(async () => {
      const other = siblings[index + dir];
      if (!other) return;
      const a = await supabase.from("lots").update({ position: index + dir }).eq("id", lot.id);
      if (a.error) throw a.error;
      const b = await supabase.from("lots").update({ position: index }).eq("id", other.id);
      if (b.error) throw b.error;
    });

  const removeLot = async () => {
    if (!(await confirmDialog({ title: `Delete "${lot.title}"?`, body: "Its photos are removed too.", confirmLabel: "Delete lot", danger: true }))) return;
    void run(async () => {
      await Promise.all(media.map((m) => deleteMedia("lot-media", m.path).catch(() => undefined)));
      const { error } = await supabase.from("lots").delete().eq("id", lot.id);
      if (error) throw error;
    });
  };

  const upload = (files: FileList) =>
    run(async () => {
      let pos = media.length;
      for (const file of Array.from(files)) {
        const up = await uploadMedia("lot-media", `${auction.id}/${lot.id}`, file);
        const { error } = await supabase.from("lot_media").insert({ lot_id: lot.id, path: up.path, kind: up.kind, position: pos++ });
        if (error) throw error;
      }
    });

  const removeMedia = (m: LotMedia) =>
    run(async () => {
      await deleteMedia("lot-media", m.path);
      const { error } = await supabase.from("lot_media").delete().eq("id", m.id);
      if (error) throw error;
    });

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-8 text-center font-mono text-sm text-stone-500">#{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{lot.title}</p>
          <p className="text-sm text-stone-500">
            {lot.sale_type !== "english" && <span className="chip mr-1.5 bg-brand-100 text-brand-700">{SALE_TYPES.find((t) => t.value === lot.sale_type)?.label}</span>}
            Start {money(lot.start_price, auction.settings)}
            {lot.buy_now_price != null && <> · Buy now {money(lot.buy_now_price, auction.settings)}</>}
            {lot.current_bid != null && <> · Current {money(lot.current_bid, auction.settings)}</>}
          </p>
        </div>
        <LotBadge status={lot.status} />
        {editable && (
          <div className="flex gap-1">
            <button className="btn-ghost px-2" disabled={busy || index === 0} onClick={() => void move(-1)} aria-label="Move up">
              &uarr;
            </button>
            <button className="btn-ghost px-2" disabled={busy || index === total - 1} onClick={() => void move(1)} aria-label="Move down">
              &darr;
            </button>
            <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
              {open ? "Close" : "Edit"}
            </button>
            <button className="btn-ghost text-red-600" disabled={busy} onClick={() => void removeLot()}>
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {media.map((m) => (
          <div key={m.id} className="group relative h-20 w-20 overflow-hidden rounded-lg bg-stone-100">
            {m.kind === "video" ? (
              <div className="flex h-full items-center justify-center bg-stone-800 text-xs text-white">Video</div>
            ) : (
              <img src={publicUrl("lot-media", m.path)} alt="" className="h-full w-full object-cover" />
            )}
            <button
              className="absolute top-1 right-1 hidden rounded bg-black/70 px-1.5 text-xs text-snow group-hover:block"
              onClick={() => void removeMedia(m)}
              disabled={busy}
            >
              x
            </button>
          </div>
        ))}
        <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-stone-300 text-xs text-stone-500 hover:border-stone-500">
          {busy ? "..." : "+ Media"}
          <input
            type="file"
            multiple
            accept="image/*,video/mp4,video/webm"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {open && editable && (
        <form onSubmit={save} className="mt-4 space-y-3 border-t border-stone-100 pt-4">
          <LotFieldInputs v={v} set={setV} disabled={busy} league={auction.mode === "league"} />
          <button className="btn-primary" disabled={busy}>
            Save lot
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
