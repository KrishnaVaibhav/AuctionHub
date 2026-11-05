import { useEffect, useState, type FormEvent } from "react";
import { supabase, errorMessage } from "../../lib/supabase";
import { fromLocalInput } from "../../lib/format";
import { confirmDialog } from "../../lib/confirm";
import type { SiteEvent } from "../../components/HomeExtras";

interface Drop {
  day: string;
  lot_id: string;
  reveal_at: string;
  teaser: string;
}

/** Themed weeks (a home banner, a filter and a badge for wins) and the daily mystery lot. */
export function EventsTab() {
  const [events, setEvents] = useState<SiteEvent[]>([]);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ev, setEv] = useState({ title: "", tag: "", description: "", color: "#8b5cf6", starts: "", ends: "" });
  const [drop, setDrop] = useState({ day: new Date().toISOString().slice(0, 10), lot: "", reveal: "", teaser: "" });

  async function load() {
    const [e, d] = await Promise.all([
      supabase.from("site_events").select("*").order("starts_at", { ascending: false }).limit(30),
      supabase.from("mystery_drops").select("*").order("day", { ascending: false }).limit(30),
    ]);
    setEvents((e.data as SiteEvent[] | null) ?? []);
    setDrops((d.data as Drop[] | null) ?? []);
  }
  useEffect(() => {
    void load();
  }, []);

  async function addEvent(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("site_events").insert({
      title: ev.title,
      tag: ev.tag.toLowerCase(),
      description: ev.description,
      color: ev.color,
      starts_at: fromLocalInput(ev.starts),
      ends_at: fromLocalInput(ev.ends),
    });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: "Event created" });
    if (!error) await load();
  }

  async function addDrop(e: FormEvent) {
    e.preventDefault();
    // Accept a lot id or a pasted lot/auction link ending in the lot id.
    const lotId = drop.lot.trim().match(/[0-9a-f-]{36}$/i)?.[0];
    if (!lotId) return setMsg({ ok: false, text: "Paste a lot id" });
    const { error } = await supabase.from("mystery_drops").upsert({ day: drop.day, lot_id: lotId, reveal_at: fromLocalInput(drop.reveal), teaser: drop.teaser });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: "Mystery lot scheduled" });
    if (!error) await load();
  }

  return (
    <div className="animate-rise space-y-6">
      {msg && <p className={`rounded-2xl px-3.5 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="section-title">Themed events</h2>
          <p className="text-sm text-stone-500">Shown as a banner on the home page while running. Auctions tagged with the event tag appear under it, and winners get an event badge.</p>
        </div>
        <form onSubmit={addEvent} className="grid gap-3 sm:grid-cols-2">
          <input className="input" required minLength={3} maxLength={60} placeholder="Title, e.g. Vintage Sunday" value={ev.title} onChange={(e) => setEv({ ...ev, title: e.target.value })} />
          <input className="input font-mono" required pattern="[a-z0-9-]{2,30}" placeholder="tag, e.g. vintage" value={ev.tag} onChange={(e) => setEv({ ...ev, tag: e.target.value })} />
          <input className="input sm:col-span-2" maxLength={300} placeholder="Short description" value={ev.description} onChange={(e) => setEv({ ...ev, description: e.target.value })} />
          <label>
            <span className="label">Starts</span>
            <input type="datetime-local" className="input" required value={ev.starts} onChange={(e) => setEv({ ...ev, starts: e.target.value })} />
          </label>
          <label>
            <span className="label">Ends</span>
            <input type="datetime-local" className="input" required value={ev.ends} onChange={(e) => setEv({ ...ev, ends: e.target.value })} />
          </label>
          <label className="flex items-center gap-3 text-sm">
            Colour <input type="color" value={ev.color} onChange={(e) => setEv({ ...ev, color: e.target.value })} className="h-10 w-14 cursor-pointer rounded-xl" />
          </label>
          <button className="btn-primary sm:justify-self-end">Create event</button>
        </form>
        <ul className="divide-y divide-stone-900/[0.06] text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <span className="h-3 w-3 rounded-full" style={{ background: e.color }} />
              <span className="min-w-0 flex-1 truncate">
                <strong>{e.title}</strong> <span className="font-mono text-xs text-stone-500">#{e.tag}</span>
              </span>
              <span className="text-xs text-stone-500">
                {new Date(e.starts_at).toLocaleDateString()} to {new Date(e.ends_at).toLocaleDateString()}
              </span>
              <button
                className="text-xs text-stone-500 hover:text-red-600"
                onClick={async () => {
                  if (!(await confirmDialog({ title: `Delete "${e.title}"?`, body: "Badges already earned stay.", confirmLabel: "Delete", danger: true }))) return;
                  await supabase.from("site_events").delete().eq("id", e.id);
                  await load();
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="section-title">Daily mystery lot</h2>
          <p className="text-sm text-stone-500">One lot per day (India date) from a public auction. The home page shows a teaser and a countdown, then reveals it.</p>
        </div>
        <form onSubmit={addDrop} className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Day</span>
            <input type="date" className="input" required value={drop.day} onChange={(e) => setDrop({ ...drop, day: e.target.value })} />
          </label>
          <label>
            <span className="label">Reveal at</span>
            <input type="datetime-local" className="input" required value={drop.reveal} onChange={(e) => setDrop({ ...drop, reveal: e.target.value })} />
          </label>
          <input className="input font-mono text-xs sm:col-span-2" required placeholder="Lot id" value={drop.lot} onChange={(e) => setDrop({ ...drop, lot: e.target.value })} />
          <input className="input" maxLength={120} placeholder="Teaser, e.g. A 1960s classic" value={drop.teaser} onChange={(e) => setDrop({ ...drop, teaser: e.target.value })} />
          <button className="btn-primary sm:justify-self-end">Schedule</button>
        </form>
        <ul className="divide-y divide-stone-900/[0.06] text-sm">
          {drops.map((d) => (
            <li key={d.day} className="flex items-center gap-3 py-2">
              <span className="font-semibold tabular-nums">{d.day}</span>
              <span className="min-w-0 flex-1 truncate text-stone-500">{d.teaser || d.lot_id}</span>
              <span className="text-xs text-stone-500">reveal {new Date(d.reveal_at).toLocaleTimeString()}</span>
              <button
                className="text-xs text-stone-500 hover:text-red-600"
                onClick={async () => {
                  await supabase.from("mystery_drops").delete().eq("day", d.day);
                  await load();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
