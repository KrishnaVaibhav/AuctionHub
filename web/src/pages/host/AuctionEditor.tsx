import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../lib/auth";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAuctionRoom } from "../../lib/useAuctionRoom";
import { formatIncrements, fromLocalInput, parseIncrements, toLocalInput } from "../../lib/format";
import { uploadMedia } from "../../lib/media";
import { DEFAULT_INCREMENTS } from "../../lib/bidding";
import type { Auction, AuctionSettings } from "../../lib/types";
import { AuctionBadge } from "../../components/StatusBadge";
import { LotEditor, NewLotForm } from "./LotEditor";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED"];

export function AuctionEditor() {
  const { id } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const room = useAuctionRoom(id);
  const { auction, lots, media, reload } = room;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (room.loading) return <p className="text-sm text-stone-500">Loading...</p>;
  if (!auction) return <p className="text-sm text-red-600">{room.error ?? "Auction not found"}</p>;
  if (auction.host_id !== session?.user.id) return <p className="text-sm text-red-600">Only the host can edit this auction.</p>;

  const editable = auction.status === "draft" || auction.status === "scheduled";

  async function rpc(fn: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    const { error } = await supabase.rpc(fn, { p_auction_id: auction!.id });
    if (error) setError(errorMessage(error));
    else {
      await reload();
      if (fn === "start_auction") navigate(`/a/${auction!.id}`);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this draft auction and all its lots? This cannot be undone.")) return;
    const { error } = await supabase.from("auctions").delete().eq("id", auction!.id);
    if (error) setError(errorMessage(error));
    else navigate("/host");
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/host" className="text-sm text-stone-500 hover:text-stone-900">
          &larr; Dashboard
        </Link>
        <AuctionBadge status={auction.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Link to={`/a/${auction.id}`} className="btn-ghost">
            Open room
          </Link>
          {auction.status === "draft" && (
            <button className="btn-ghost" onClick={() => void rpc("schedule_auction")}>
              Schedule
            </button>
          )}
          {auction.status === "scheduled" && (
            <button className="btn-ghost" onClick={() => void rpc("unschedule_auction")}>
              Back to draft
            </button>
          )}
          {editable && (
            <button className="btn-accent" onClick={() => void rpc("start_auction", "Go live now? Lots open immediately.")}>
              Go live now
            </button>
          )}
          {auction.status === "draft" && (
            <button className="btn-danger" onClick={() => void remove()}>
              Delete
            </button>
          )}
          {!["draft", "ended", "cancelled"].includes(auction.status) && (
            <button className="btn-danger" onClick={() => void rpc("cancel_auction", "Cancel this auction? All open lots are withdrawn.")}>
              Cancel auction
            </button>
          )}
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <AuctionForm auction={auction} onSaved={async (msg) => { setNotice(msg); await reload(); }} onError={setError} />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Lots ({lots.length})</h2>
          {!editable && <p className="text-xs text-stone-500">Lot details lock once the auction starts. You can still add photos.</p>}
        </div>
        {lots.map((lot, i) => (
          <LotEditor
            key={lot.id}
            auction={auction}
            lot={lot}
            index={i}
            total={lots.length}
            siblings={lots}
            media={media.get(lot.id) ?? []}
            editable={editable}
            onChange={reload}
          />
        ))}
        {editable && <NewLotForm auction={auction} nextPosition={lots.length} onCreated={reload} />}
      </section>
    </div>
  );
}

function AuctionForm({
  auction,
  onSaved,
  onError,
}: {
  auction: Auction;
  onSaved: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const s = auction.settings;
  const [title, setTitle] = useState(auction.title);
  const [description, setDescription] = useState(auction.description);
  const [startsAt, setStartsAt] = useState(toLocalInput(auction.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(auction.ends_at));
  const [streamUrl, setStreamUrl] = useState(auction.stream_url ?? "");
  const [currency, setCurrency] = useState(s.currency ?? "INR");
  const [antiSnipe, setAntiSnipe] = useState(String(s.anti_snipe_seconds ?? 30));
  const [duration, setDuration] = useState(String(s.lot_duration_minutes ?? 10));
  const [stagger, setStagger] = useState(String(s.lot_stagger_seconds ?? 0));
  const [chatEnabled, setChatEnabled] = useState(s.chat?.enabled !== false);
  const [slowMode, setSlowMode] = useState(String(s.chat?.slow_mode_s ?? 2));
  const [increments, setIncrements] = useState(formatIncrements(s.increments ?? DEFAULT_INCREMENTS));
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    onError(null);
    const inc = parseIncrements(increments);
    if (!inc) {
      onError('Increment table format: "0:10, 1000:50" (from amount : step)');
      return;
    }
    const settings: AuctionSettings = {
      ...auction.settings,
      currency,
      increments: inc,
      anti_snipe_seconds: Math.max(0, Number(antiSnipe) || 0),
      lot_duration_minutes: Math.max(1, Number(duration) || 10),
      lot_stagger_seconds: Math.max(0, Number(stagger) || 0),
      chat: { enabled: chatEnabled, slow_mode_s: Math.max(0, Number(slowMode) || 0) },
    };
    setBusy(true);
    const { error } = await supabase
      .from("auctions")
      .update({
        title: title.trim(),
        description,
        starts_at: fromLocalInput(startsAt),
        ends_at: fromLocalInput(endsAt),
        stream_url: streamUrl.trim() || null,
        settings,
      })
      .eq("id", auction.id);
    setBusy(false);
    if (error) onError(errorMessage(error));
    else await onSaved("Auction saved");
  }

  async function cover(file: File) {
    onError(null);
    setBusy(true);
    try {
      const { url } = await uploadMedia("auction-branding", auction.id, file, { maxSide: 1920, maxMB: 0.5 });
      const { error } = await supabase.from("auctions").update({ cover_url: url }).eq("id", auction.id);
      if (error) throw error;
      await onSaved("Cover updated");
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card grid gap-6 p-5 lg:grid-cols-[1fr_18rem]">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="t">
            Title
          </label>
          <input id="t" className="input" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="d">
            Description
          </label>
          <textarea id="d" className="input min-h-28" maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sa">
              Starts at
            </label>
            <input id="sa" type="datetime-local" className="input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="ea">
              Lots close at (optional)
            </label>
            <input id="ea" type="datetime-local" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="su">
            Live stream link (YouTube or Twitch)
          </label>
          <input
            id="su"
            className="input"
            type="url"
            pattern="https://.*"
            placeholder="https://www.youtube.com/live/..."
            value={streamUrl}
            onChange={(e) => setStreamUrl(e.target.value)}
          />
        </div>

        <fieldset className="grid gap-4 rounded-xl bg-stone-50 p-4 sm:grid-cols-3">
          <legend className="px-1 text-sm font-semibold">Bidding rules</legend>
          <div>
            <label className="label" htmlFor="cur">
              Currency
            </label>
            <select id="cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="as">
              Anti-snipe (sec)
            </label>
            <input id="as" type="number" min={0} max={600} className="input" value={antiSnipe} onChange={(e) => setAntiSnipe(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="du">
              Lot duration (min)
            </label>
            <input id="du" type="number" min={1} max={10080} className="input" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="st">
              Stagger lots (sec)
            </label>
            <input id="st" type="number" min={0} className="input" value={stagger} onChange={(e) => setStagger(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="inc">
              Increments (from : step)
            </label>
            <input id="inc" className="input font-mono" value={increments} onChange={(e) => setIncrements(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={chatEnabled} onChange={(e) => setChatEnabled(e.target.checked)} />
            Chat enabled
          </label>
          <div>
            <label className="label" htmlFor="sm">
              Chat slow mode (sec)
            </label>
            <input id="sm" type="number" min={0} max={300} className="input" value={slowMode} onChange={(e) => setSlowMode(e.target.value)} />
          </div>
        </fieldset>
        <p className="text-xs text-stone-500">
          Lots close at the "Lots close at" time, or after the lot duration if it's empty. Stagger closes each next lot later. A bid in
          the anti-snipe window extends that lot.
        </p>
        <button className="btn-primary" disabled={busy}>
          Save auction
        </button>
      </div>

      <div>
        <p className="label">Cover image</p>
        <div className="aspect-[16/9] overflow-hidden rounded-xl bg-stone-100">
          {auction.cover_url && <img src={auction.cover_url} alt="" className="h-full w-full object-cover" />}
        </div>
        <label className="btn-ghost mt-3 w-full cursor-pointer">
          Upload cover
          <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && void cover(e.target.files[0])} />
        </label>
      </div>
    </form>
  );
}
