import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
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

function LotFieldInputs({
  v,
  set,
  disabled,
  league,
  collapse,
  titleRef,
}: {
  v: LotFields;
  set: (v: LotFields) => void;
  disabled?: boolean;
  league?: boolean;
  /** Put sale type, reserve, buy now and details under "More options". */
  collapse?: boolean;
  titleRef?: Ref<HTMLInputElement>;
}) {
  const help = SALE_TYPES.find((t) => t.value === v.saleType)?.help;
  const used = v.saleType !== "english" || v.reserve.trim() !== "" || v.buyNow.trim() !== "" || v.fields.trim() !== "";

  const extras = (
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
            <p className="mt-1 block text-xs leading-snug text-stone-500">How much the price falls at each step.</p>
          </div>
          <div>
            <label className="label">Every (seconds)</label>
            <input className="input" type="number" min={5} max={3600} step={1} required disabled={disabled} value={v.dutchInterval} onChange={(e) => set({ ...v, dutchInterval: e.target.value })} />
            <p className="mt-1 block text-xs leading-snug text-stone-500">Time between price drops.</p>
          </div>
          <div>
            <label className="label">Floor price</label>
            <input className="input" type="number" min={0.01} step="0.01" required disabled={disabled} value={v.dutchFloor} onChange={(e) => set({ ...v, dutchFloor: e.target.value })} />
            <p className="mt-1 block text-xs leading-snug text-stone-500">The price never drops below this.</p>
          </div>
        </>
      )}
      <div>
        <label className="label">Reserve (secret, optional)</label>
        <input className="input" type="number" min={0} step="0.01" disabled={disabled} value={v.reserve} onChange={(e) => set({ ...v, reserve: e.target.value })} />
        <p className="mt-1 block text-xs leading-snug text-stone-500">Lowest price you will accept. Hidden from bidders; below it the lot does not sell.</p>
      </div>
      <div>
        <label className="label">Buy now (optional)</label>
        <input className="input" type="number" min={0} step="0.01" disabled={disabled} value={v.buyNow} onChange={(e) => set({ ...v, buyNow: e.target.value })} />
        <p className="mt-1 block text-xs leading-snug text-stone-500">Anyone can pay this to win the lot at once and end it.</p>
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
        <p className="mt-1 block text-xs leading-snug text-stone-500">Shown as a small table on the lot, e.g. "Year: 1972".</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label">Title</label>
          <input ref={titleRef} className="input" required maxLength={120} disabled={disabled} value={v.title} onChange={(e) => set({ ...v, title: e.target.value })} />
          <p className="mt-1 block text-xs leading-snug text-stone-500">Short name bidders see on the lot card.</p>
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
          <p className="mt-1 block text-xs leading-snug text-stone-500">Where bidding begins. For a league, the player's base price.</p>
        </div>
        <div className="sm:col-span-3">
          <label className="label">Description</label>
          <textarea
            className="input min-h-20"
            maxLength={5000}
            disabled={disabled}
            value={v.description}
            onChange={(e) => set({ ...v, description: e.target.value })}
          />
          <p className="mt-1 block text-xs leading-snug text-stone-500">Condition, size, history: anything that helps people bid.</p>
        </div>
      </div>
      {collapse ? (
        <details className="rounded-2xl bg-stone-900/[0.03] px-4 py-3 dark:bg-snow/[0.04]" open={used}>
          <summary className="cursor-pointer text-sm font-semibold text-stone-700">
            More options <span className="font-normal text-stone-500">: {league ? "reserve, buy now, details" : "sale type, reserve, buy now, details"}</span>
          </summary>
          <div className="mt-3">{extras}</div>
        </details>
      ) : (
        extras
      )}
    </div>
  );
}

/** A field that fails validation inside a closed "More options" can't be shown: open it first. */
const openInvalid = (e: FormEvent) => (e.target as HTMLElement).closest("details")?.setAttribute("open", "");

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
    saleType: auction.mode === "league" ? "english" : (auction.settings.default_sale_type ?? "english"),
    dutchStep: "",
    dutchFloor: "",
    dutchInterval: "60",
  };
  const [v, setV] = useState<LotFields>(empty);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Thumbnails of the photos picked so far.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : ""));
    setPreviews(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const invalid = validate(v);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError(null);
    setAdded(null);
    let lotId: string;
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
      lotId = data.id;
      await saveReserve(lotId, num(v.reserve));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    // The lot exists now: clear the form even if a photo fails, so it isn't added twice.
    const title = v.title.trim();
    const picked = files;
    setV(empty);
    setFiles([]);
    try {
      let pos = 0;
      for (const file of picked) {
        const up = await uploadMedia("lot-media", `${auction.id}/${lotId}`, file);
        const { error } = await supabase.from("lot_media").insert({ lot_id: lotId, path: up.path, kind: up.kind, position: pos++ });
        if (error) throw error;
      }
      setAdded(`Added "${title}". Add the next one, or go live when you're ready.`);
    } catch (err) {
      setError(`"${title}" was added, but a photo didn't upload (${errorMessage(err)}). Add it from the lot below.`);
    }
    await onCreated();
    setBusy(false);
    // After React re-enables the fields: back to the title for the next lot.
    setTimeout(() => titleRef.current?.focus(), 0);
  }

  return (
    <form onSubmit={create} onInvalidCapture={openInvalid} className="card space-y-4 border-dashed p-5">
      <h3 className="section-title text-base">Add a lot</h3>
      <LotFieldInputs v={v} set={setV} league={auction.mode === "league"} collapse titleRef={titleRef} disabled={busy} />
      <div>
        <p className="label">Photos and video</p>
        <div className="flex flex-wrap items-center gap-2">
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="relative h-16 w-16 overflow-hidden rounded-xl bg-stone-100">
              {previews[i] ? (
                <img src={previews[i]} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center bg-stone-800 text-[10px] text-white">Video</div>
              )}
              <button
                type="button"
                className="absolute top-0.5 right-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-snow"
                onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
              >
                &times;
              </button>
            </div>
          ))}
          <label className="flex h-16 min-w-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-stone-300 px-3 text-xs font-medium text-stone-500 transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700">
            + {files.length ? "More" : "Add photos"}
            <input
              type="file"
              multiple
              accept="image/*,video/mp4,video/webm"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length) setFiles((prev) => [...prev, ...list]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="mt-1 text-xs text-stone-500">Optional. They upload when you add the lot; you can add more later.</p>
      </div>
      {auction.mode !== "league" && <PriceHint category={auction.category} title={v.title} settings={auction.settings} />}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {added && <p role="status" className="text-sm font-medium text-emerald-700">{added}</p>}
      <button className="btn-primary" disabled={busy}>
        {busy ? "Adding..." : files.length ? `Add lot with ${files.length} ${files.length === 1 ? "file" : "files"}` : "Add lot"}
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

/** A lot's saved values, as the edit form holds them (the reserve loads separately). */
function fieldsOf(lot: Lot): LotFields {
  return {
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
  };
}

export function LotEditor({ auction, lot, index, total, siblings, media, editable, onChange }: EditorProps) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<LotFields>(() => fieldsOf(lot));
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

  const cover = media.find((m) => m.kind === "image");
  const photoWord = media.length === 1 ? "1 photo" : `${media.length} photos`;

  return (
    <div className={`card p-3 sm:p-4 ${open ? "ring-2 ring-brand-300" : ""}`}>
      {/* One calm line per lot; photos and fields open on demand. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-stone-900/[0.05] font-mono text-xs font-semibold text-stone-600 tabular-nums dark:bg-snow/[0.06]">{index + 1}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="h-14 w-14 flex-none overflow-hidden rounded-2xl bg-stone-100 dark:bg-snow/[0.06]" aria-label={open ? `Close ${lot.title}` : `Open ${lot.title}`}>
          {cover ? (
            <img src={publicUrl("lot-media", cover.path)} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-full items-center justify-center text-[10px] font-semibold text-stone-500">No photo</span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{lot.title}</p>
          <p className="text-sm text-stone-500">
            {lot.sale_type !== "english" && <span className="chip mr-1.5 bg-brand-100 text-brand-700">{SALE_TYPES.find((t) => t.value === lot.sale_type)?.label}</span>}
            Start {money(lot.start_price, auction.settings)}
            {lot.buy_now_price != null && <> · Buy now {money(lot.buy_now_price, auction.settings)}</>}
            {lot.current_bid != null && <> · Current {money(lot.current_bid, auction.settings)}</>}
            {" · "}
            <span className={media.length ? "" : "font-medium text-amber-700"}>{media.length ? photoWord : "no photo"}</span>
          </p>
        </div>
        <LotBadge status={lot.status} />
        <div className="flex gap-1">
          {editable && (
            <>
              <button className="btn-ghost h-10 w-10 p-0" disabled={busy || index === 0} onClick={() => void move(-1)} aria-label={`Move ${lot.title} up`}>
                &uarr;
              </button>
              <button className="btn-ghost h-10 w-10 p-0" disabled={busy || index === total - 1} onClick={() => void move(1)} aria-label={`Move ${lot.title} down`}>
                &darr;
              </button>
            </>
          )}
          <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Done" : editable ? "Edit" : "Photos"}
          </button>
          {editable && (
            <button className="btn-ghost text-red-600" disabled={busy} onClick={() => void removeLot()} aria-label={`Delete ${lot.title}`}>
              Delete
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-stone-900/[0.06] pt-4 dark:border-snow/[0.06]">
          <div>
            <p className="label">Photos and video</p>
            <div className="flex flex-wrap items-center gap-2">
              {media.map((m) => (
                <div key={m.id} className="group relative h-20 w-20 overflow-hidden rounded-2xl bg-stone-100">
                  {m.kind === "video" ? (
                    <div className="flex h-full items-center justify-center bg-stone-800 text-xs text-white">Video</div>
                  ) : (
                    <img src={publicUrl("lot-media", m.path)} alt="" className="h-full w-full object-cover" />
                  )}
                  <button
                    type="button"
                    className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-sm text-snow transition [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void removeMedia(m)}
                    disabled={busy}
                    aria-label="Remove this photo"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 text-xs font-medium text-stone-500 transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700">
                {busy ? "..." : "+ Add"}
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
            {media.length > 0 && <p className="mt-1 text-xs text-stone-500">The first photo is the cover bidders see.</p>}
          </div>

          {editable && (
            <form onSubmit={save} onInvalidCapture={openInvalid} className="space-y-3">
              <LotFieldInputs v={v} set={setV} disabled={busy} league={auction.mode === "league"} collapse />
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy}>
                  Save lot
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => (setV(fieldsOf(lot)), setOpen(false))}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
