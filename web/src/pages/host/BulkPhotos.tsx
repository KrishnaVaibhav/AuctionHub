import { useMemo, useState } from "react";
import { ImagesIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../../lib/supabase";
import { uploadMedia } from "../../lib/media";
import { planPhotos, runLimited, titleFromGroup, type PhotoPlan, type Target } from "../../lib/bulkPhotos";
import type { Auction, Lot, LotMedia } from "../../lib/types";

const MAX_FILES = 300;

/** Drop many photos at once; each goes to the lot its file name points at, or becomes a new lot. */
export function BulkPhotos({
  auction,
  lots,
  media,
  editable,
  onDone,
}: {
  auction: Auction;
  lots: Lot[];
  media: Map<string, LotMedia[]>;
  editable: boolean;
  onDone: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<PhotoPlan[] | null>(null);
  const [startPrice, setStartPrice] = useState("100");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const league = auction.mode === "league";
  const noun = league ? "player" : "lot";

  function choose(files: FileList | null) {
    setMsg(null);
    setFailed([]);
    const list = Array.from(files ?? []);
    if (list.length > MAX_FILES) return setMsg(`Up to ${MAX_FILES} files at a time.`);
    const p = planPhotos(list, lots).map((x) =>
      // New lots can only be added while the auction is still a draft or scheduled.
      x.target.kind === "new" && !editable ? { ...x, target: { kind: "skip" } as Target } : x,
    );
    setPlan(p);
  }

  function retarget(i: number, value: string) {
    if (!plan) return;
    const next = [...plan];
    const t: Target = value === "skip" ? { kind: "skip" } : value.startsWith("new:") ? { kind: "new", group: value.slice(4) } : { kind: "lot", lotId: value };
    next[i] = { ...next[i], target: t };
    setPlan(next);
  }

  const groups = useMemo(() => [...new Set((plan ?? []).flatMap((p) => (p.target.kind === "new" ? [p.target.group] : [])))], [plan]);
  const counts = useMemo(() => {
    const c = { lot: 0, new: 0, skip: 0 };
    for (const p of plan ?? []) c[p.target.kind]++;
    return c;
  }, [plan]);

  async function upload() {
    if (!plan) return;
    const work = plan.filter((p) => p.target.kind !== "skip");
    if (work.length === 0) return;
    setMsg(null);
    setFailed([]);
    setProgress({ done: 0, total: work.length });
    try {
      // 1. Create one lot per new group.
      const groupLot = new Map<string, string>();
      if (groups.length) {
        const price = Number(startPrice);
        if (!(price > 0)) throw new Error("Enter a start price for the new lots");
        const rows = groups.map((g, i) => ({
          id: crypto.randomUUID(),
          auction_id: auction.id,
          position: lots.length + i,
          title: titleFromGroup(g).slice(0, 120),
          start_price: price,
        }));
        const { error } = await supabase.from("lots").insert(rows);
        if (error) throw error;
        rows.forEach((r, i) => groupLot.set(groups[i], r.id));
      }

      // 2. Upload, three at a time, appending after each lot's existing photos.
      const nextPos = new Map<string, number>();
      const lotOf = (t: Target) => (t.kind === "lot" ? t.lotId : t.kind === "new" ? groupLot.get(t.group)! : "");
      for (const p of work) {
        const id = lotOf(p.target);
        if (!nextPos.has(id)) nextPos.set(id, (media.get(id) ?? []).reduce((m, x) => Math.max(m, x.position + 1), 0));
      }
      const jobs = work.map((p) => {
        const id = lotOf(p.target);
        const position = nextPos.get(id)!;
        nextPos.set(id, position + 1);
        return { p, id, position };
      });
      const bad: string[] = [];
      await runLimited(
        jobs,
        3,
        async ({ p, id, position }) => {
          try {
            const up = await uploadMedia("lot-media", `${auction.id}/${id}`, p.file);
            const { error } = await supabase.from("lot_media").insert({ lot_id: id, path: up.path, kind: up.kind, position });
            if (error) throw error;
          } catch (err) {
            bad.push(`${p.file.name}: ${errorMessage(err)}`);
          }
        },
        (done) => setProgress({ done, total: jobs.length }),
      );
      setFailed(bad);
      setMsg(`Added ${jobs.length - bad.length} of ${jobs.length} photos${groups.length ? ` and ${groups.length} new ${noun}s` : ""}.`);
      setPlan(null);
      await onDone();
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setProgress(null);
    }
  }

  const lotLabel = (id: string) => {
    const l = lots.find((x) => x.id === id);
    return l ? `#${l.position + 1} ${l.title}` : "?";
  };

  return (
    <div className="card space-y-4 border-dashed p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
          <ImagesIcon size={22} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="section-title text-base">Bulk add photos</h3>
          <p className="text-sm text-stone-500">
            Name files by {noun} number (<span className="font-mono text-xs">12.jpg</span>, <span className="font-mono text-xs">12-2.jpg</span>) or by title (
            <span className="font-mono text-xs">brass-lamp.jpg</span>).{editable ? ` Other names become new ${noun}s.` : ""}
          </p>
        </div>
        <label className="btn-accent cursor-pointer">
          Choose photos
          <input
            type="file"
            multiple
            accept="image/*,video/mp4,video/webm"
            className="sr-only"
            disabled={progress !== null}
            onChange={(e) => {
              choose(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {plan && (
        <>
          <p className="text-sm">
            <strong>{counts.lot}</strong> matched · <strong>{counts.new}</strong> for {groups.length} new {noun}s · <strong>{counts.skip}</strong> skipped
          </p>
          <ul className="max-h-80 divide-y divide-stone-900/[0.06] overflow-y-auto rounded-2xl bg-stone-900/[0.03] text-sm">
            {plan.map((p, i) => (
              <li key={p.file.name + i} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={p.file.name}>
                  {p.file.name}
                </span>
                <select
                  aria-label={`Where ${p.file.name} goes`}
                  className="input w-56 py-1.5"
                  value={p.target.kind === "lot" ? p.target.lotId : p.target.kind === "new" ? `new:${p.target.group}` : "skip"}
                  onChange={(e) => retarget(i, e.target.value)}
                >
                  {lots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {lotLabel(l.id)}
                    </option>
                  ))}
                  {editable &&
                    [...new Set([...groups, ...(p.target.kind === "new" ? [p.target.group] : [])])].map((g) => (
                      <option key={g} value={`new:${g}`}>
                        New: {titleFromGroup(g)}
                      </option>
                    ))}
                  <option value="skip">Skip</option>
                </select>
              </li>
            ))}
          </ul>
          {groups.length > 0 && (
            <label className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">Start price for new {noun}s</span>
              <input type="number" min={1} className="input w-32" value={startPrice} onChange={(e) => setStartPrice(e.target.value)} />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={progress !== null || counts.lot + counts.new === 0} onClick={() => void upload()}>
              Upload {counts.lot + counts.new} photos
            </button>
            <button className="btn-ghost" disabled={progress !== null} onClick={() => setPlan(null)}>
              Cancel
            </button>
          </div>
        </>
      )}

      {progress && (
        <div className="space-y-1.5" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-stone-900/[0.06]">
            <div className="h-full rounded-full bg-brand-500 transition-[width] duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <p className="text-xs text-stone-500 tabular-nums">
            Uploading {progress.done} / {progress.total}
          </p>
        </div>
      )}
      {msg && <p className="text-sm text-stone-700">{msg}</p>}
      {failed.length > 0 && (
        <ul className="space-y-0.5 text-xs text-red-600">
          {failed.slice(0, 10).map((f) => (
            <li key={f}>{f}</li>
          ))}
          {failed.length > 10 && <li>and {failed.length - 10} more</li>}
        </ul>
      )}
    </div>
  );
}
