import { useState } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontalIcon, XIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../../lib/supabase";
import { FEATURES, funOn, type FeatureKey } from "../../lib/fun";
import type { Auction, Lot } from "../../lib/types";
import { Toggle } from "../Glass";

/** Everything the host can change mid-auction, in one sheet. */
export function HostRoomControls({ auction, lots, selected }: { auction: Auction; lots: Lot[]; selected?: Lot }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(auction.announcement ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [minutes, setMinutes] = useState("5");
  // Switches flip at once; the realtime auction update confirms them.
  const [pending, setPending] = useState<Partial<Record<FeatureKey, boolean>>>({});
  const done = (error: unknown, ok: string) => setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: ok });

  async function feature(key: FeatureKey, value: boolean) {
    setPending((p) => ({ ...p, [key]: value }));
    const { error } = await supabase.rpc("host_set_features", { p_auction_id: auction.id, p_features: { [key]: value } });
    if (error) setPending((p) => ({ ...p, [key]: !value }));
    done(error, value ? "Turned on" : "Turned off");
  }
  async function announce(value: string) {
    const { error } = await supabase.rpc("host_set_announcement", { p_auction_id: auction.id, p_text: value });
    done(error, value.trim() ? "Announcement posted" : "Announcement cleared");
  }
  async function extend(lot: Lot, seconds: number) {
    const base = Math.max(Date.now(), lot.ends_at ? new Date(lot.ends_at).getTime() : Date.now());
    const { error } = await supabase.rpc("set_lot_end", { p_lot_id: lot.id, p_ends_at: new Date(base + seconds * 1000).toISOString() });
    done(error, `Added ${seconds >= 60 ? `${seconds / 60} min` : `${seconds}s`}`);
  }
  async function endIn(lot: Lot, seconds: number) {
    const { error } = await supabase.rpc("set_lot_end", { p_lot_id: lot.id, p_ends_at: new Date(Date.now() + seconds * 1000).toISOString() });
    done(error, `Closes in ${seconds}s`);
  }
  async function spotlight(lotId: string | null) {
    const { error } = await supabase.rpc("host_spotlight", { p_auction_id: auction.id, p_lot_id: lotId });
    done(error, lotId ? "Spotlight set for everyone" : "Spotlight cleared");
  }
  async function reopen(lot: Lot) {
    const { error } = await supabase.rpc("reopen_lot", { p_lot_id: lot.id, p_minutes: Number(minutes) });
    done(error, `"${lot.title}" is open again`);
  }

  const reopenable = lots.filter((l) => l.status === "unsold" || l.status === "withdrawn");
  const timed = selected?.status === "open" && auction.mode !== "league";

  return (
    <>
      <button className="btn-ghost py-1.5" onClick={() => setOpen(true)}>
        <SlidersHorizontalIcon size={16} weight="bold" aria-hidden="true" />
        Room
      </button>
      {open &&
        createPortal(
          <div className="scrim flex justify-end" onClick={() => setOpen(false)}>
            <div
              role="dialog"
              aria-label="Room controls"
              className="glass-thick h-full w-full max-w-md animate-rise space-y-6 overflow-y-auto p-5 sm:rounded-l-[32px] sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="section-title">Room controls</h2>
                <button className="btn-icon" onClick={() => setOpen(false)} aria-label="Close">
                  <XIcon size={18} weight="bold" aria-hidden="true" />
                </button>
              </div>
              {msg && <p className={`rounded-2xl px-3.5 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

              <section className="space-y-2">
                <h3 className="label">Announcement</h3>
                <p className="mt-1 block text-xs leading-snug text-stone-500">A short line pinned to the top of the room for every viewer.</p>
                <textarea className="input min-h-20" maxLength={200} placeholder="Shown at the top of the room for everyone" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="flex gap-2">
                  <button className="btn-accent" onClick={() => void announce(text)}>
                    Post
                  </button>
                  {auction.announcement && (
                    <button className="btn-ghost" onClick={() => { setText(""); void announce(""); }}>
                      Clear
                    </button>
                  )}
                </div>
              </section>

              {timed && selected && (
                <section className="space-y-2">
                  <h3 className="label">Timer · #{selected.position + 1} {selected.title}</h3>
                <p className="mt-1 block text-xs leading-snug text-stone-500">Add time to the open lot, or close it in 10 seconds.</p>
                  <div className="flex flex-wrap gap-2">
                    {[30, 60, 300].map((s) => (
                      <button key={s} className="btn-ghost" onClick={() => void extend(selected, s)}>
                        +{s >= 60 ? `${s / 60} min` : `${s}s`}
                      </button>
                    ))}
                    <button className="btn-ghost text-red-600" onClick={() => void endIn(selected, 10)}>
                      Close in 10s
                    </button>
                  </div>
                </section>
              )}

              {auction.mode !== "league" && (
                <section className="space-y-2">
                  <h3 className="label">Spotlight</h3>
                  <p className="text-xs text-stone-500">Opens this lot on every viewer's screen.</p>
                  <select className="input" value={auction.spotlight_lot_id ?? ""} onChange={(e) => void spotlight(e.target.value || null)}>
                    <option value="">No spotlight</option>
                    {lots
                      .filter((l) => l.status === "open" || l.status === "pending")
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          #{l.position + 1} {l.title}
                        </option>
                      ))}
                  </select>
                </section>
              )}

              {reopenable.length > 0 && auction.mode !== "league" && (
                <section className="space-y-2">
                  <h3 className="label">Reopen a lot</h3>
                <p className="mt-1 block text-xs leading-snug text-stone-500">Puts an unsold or withdrawn lot back up for bidding.</p>
                  <div className="flex items-center gap-2 text-sm">
                    for
                    <input type="number" min={1} max={1440} className="input w-24" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                    minutes
                  </div>
                  <ul className="divide-y divide-stone-900/[0.06] text-sm">
                    {reopenable.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                        <span className="truncate">
                          #{l.position + 1} {l.title} <span className="text-xs text-stone-500">({l.status})</span>
                        </span>
                        <button className="btn-ghost px-3 py-1 text-xs" onClick={() => void reopen(l)}>
                          Reopen
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="space-y-1">
                <h3 className="label">Features</h3>
                <div className="group-list">
                  {FEATURES.filter((f) => (auction.mode === "league" ? true : f.key !== "pickem")).map((f) => (
                    <label key={f.key} className="group-row cursor-pointer justify-between">
                      <span>
                        <span className="block text-sm font-medium">{f.label}</span>
                        <span className="block text-xs text-stone-500">{f.hint}</span>
                      </span>
                      <Toggle checked={pending[f.key] ?? funOn(auction.settings, f.key)} onChange={(v) => void feature(f.key, v)} />
                    </label>
                  ))}
                </div>
              </section>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
