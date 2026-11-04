import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "../../lib/auth";
import { supabase, errorMessage } from "../../lib/supabase";
import { useAuctionRoom } from "../../lib/useAuctionRoom";
import { formatIncrements, fromLocalInput, parseIncrements, toLocalInput } from "../../lib/format";
import { uploadMedia } from "../../lib/media";
import { DEFAULT_INCREMENTS } from "../../lib/bidding";
import { LEAGUE_DEFAULTS, LEAGUE_INCREMENTS } from "../../lib/useLeagueTeams";
import type { Auction, AuctionSettings } from "../../lib/types";
import { AuctionBadge } from "../../components/StatusBadge";
import { LotEditor, NewLotForm } from "./LotEditor";
import { VisibilityPanel } from "./VisibilityPanel";
import { ModeratorsPanel } from "./ModeratorsPanel";
import { ImportLots } from "./ImportLots";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { canDelete, deleteAuctionCompletely } from "../../lib/auctions";
import { CATEGORIES, parseTags } from "../../lib/categories";
import { confirmDialog, type ConfirmOptions } from "../../lib/confirm";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED", "PTS"];

/** Remount per auction so no state (form fields, selection, tabs) leaks between auctions. */
export function AuctionEditor() {
  const { id } = useParams();
  return <AuctionEditorInner key={id} />;
}

function AuctionEditorInner() {
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

  async function rpc(fn: string, confirm?: ConfirmOptions) {
    if (confirm && !(await confirmDialog(confirm))) return;
    setError(null);
    const { error } = await supabase.rpc(fn, { p_auction_id: auction!.id });
    if (error) setError(errorMessage(error));
    else {
      await reload();
      if (fn === "start_auction") navigate(`/a/${auction!.id}`);
    }
  }

  async function duplicate() {
    setError(null);
    const { data, error } = await supabase.rpc("duplicate_auction", { p_auction_id: auction!.id });
    if (error) setError(errorMessage(error));
    else navigate(`/host/a/${data}`);
  }

  async function remove() {
    const ok = await confirmDialog({
      title: "Delete this auction?",
      body: "All lots, bids, chat, teams and uploaded files are removed. This can't be undone.",
      confirmLabel: "Delete auction",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteAuctionCompletely(auction!);
      navigate("/host");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/host" className="text-sm text-stone-500 hover:text-stone-900">
          &larr; Dashboard
        </Link>
        <AuctionBadge status={auction.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => void duplicate()}>
            Duplicate
          </button>
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
            <button className="btn-accent" onClick={() => void rpc("start_auction", { title: "Go live now?", body: "Lots open for bidding immediately.", confirmLabel: "Go live" })}>
              Go live now
            </button>
          )}
          {canDelete(auction.status) && (
            <button className="btn-danger" onClick={() => void remove()}>
              Delete
            </button>
          )}
          {!["draft", "ended", "cancelled"].includes(auction.status) && (
            <button className="btn-danger" onClick={() => void rpc("cancel_auction", { title: "Cancel this auction?", body: "All open lots are withdrawn.", confirmLabel: "Cancel auction", cancelLabel: "Keep", danger: true })}>
              Cancel auction
            </button>
          )}
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <VisibilityPanel auction={auction} onChanged={reload} />
        <ModeratorsPanel auction={auction} />
      </div>

      <AuctionForm auction={auction} onSaved={async (msg) => { setNotice(msg); await reload(); }} onError={setError} />

      {auction.status !== "draft" && <AnalyticsPanel auction={auction} />}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{auction.mode === "league" ? "Players" : "Lots"} ({lots.length})</h2>
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
        {editable && <ImportLots auction={auction} nextPosition={lots.length} onDone={reload} />}
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
  const [category, setCategory] = useState(auction.category ?? "");
  const [tags, setTags] = useState((auction.tags ?? []).join(", "));
  const [currency, setCurrency] = useState(s.currency ?? "INR");
  const [antiSnipe, setAntiSnipe] = useState(String(s.anti_snipe_seconds ?? 30));
  const [duration, setDuration] = useState(String(s.lot_duration_minutes ?? 10));
  const [stagger, setStagger] = useState(String(s.lot_stagger_seconds ?? 0));
  const [chatEnabled, setChatEnabled] = useState(s.chat?.enabled !== false);
  const [allowLinks, setAllowLinks] = useState(Boolean(s.chat?.allow_links));
  const [slowMode, setSlowMode] = useState(String(s.chat?.slow_mode_s ?? 2));
  const [increments, setIncrements] = useState(formatIncrements(s.increments ?? DEFAULT_INCREMENTS));
  const [mode, setMode] = useState(auction.mode);
  const lg = { ...LEAGUE_DEFAULTS, ...s.league };
  const [compact, setCompact] = useState(Boolean(s.compact));
  const [purse, setPurse] = useState(String(lg.purse));
  const [squadMin, setSquadMin] = useState(String(lg.squad_min));
  const [squadMax, setSquadMax] = useState(String(lg.squad_max));
  const [maxTeams, setMaxTeams] = useState(String(lg.max_teams));
  const [lotSeconds, setLotSeconds] = useState(String(lg.lot_seconds));
  const [bidSeconds, setBidSeconds] = useState(String(lg.bid_seconds));
  const [breakSeconds, setBreakSeconds] = useState(String(lg.break_seconds));
  const [minBase, setMinBase] = useState(String(lg.min_base));
  const [hostCanPlay, setHostCanPlay] = useState(lg.host_can_play);
  const [busy, setBusy] = useState(false);

  function chooseMode(next: "standard" | "league") {
    setMode(next);
    if (next === "league") {
      setCompact(true);
      if (increments === formatIncrements(DEFAULT_INCREMENTS)) setIncrements(formatIncrements(LEAGUE_INCREMENTS));
    }
  }

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
      chat: { enabled: chatEnabled, slow_mode_s: Math.max(0, Number(slowMode) || 0), allow_links: allowLinks },
      compact,
      league: {
        purse: Math.max(1, Number(purse) || LEAGUE_DEFAULTS.purse),
        squad_min: Math.max(0, Number(squadMin) || 0),
        squad_max: Math.max(1, Number(squadMax) || LEAGUE_DEFAULTS.squad_max),
        max_teams: Math.max(2, Number(maxTeams) || LEAGUE_DEFAULTS.max_teams),
        lot_seconds: Math.max(5, Number(lotSeconds) || LEAGUE_DEFAULTS.lot_seconds),
        bid_seconds: Math.max(3, Number(bidSeconds) || LEAGUE_DEFAULTS.bid_seconds),
        break_seconds: Math.max(0, Number(breakSeconds) || 0),
        min_base: Math.max(0, Number(minBase) || 0),
        host_can_play: hostCanPlay,
      },
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
        category: category || null,
        tags: parseTags(tags),
        settings,
        ...(auction.status === "draft" ? { mode } : {}),
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cat">
              Category
            </label>
            <select id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Choose a category</option>
              {CATEGORIES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tags">
              Tags (comma separated, up to 8)
            </label>
            <input id="tags" className="input" placeholder="vintage, silver, 1970s" value={tags} onChange={(e) => setTags(e.target.value)} />
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

        <div>
          <p className="label">Auction type</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["standard", "Standard auction", "Many lots, timed or host-run. Real bids from anyone."],
                ["league", "Team league (IPL-style)", "Teams join with a virtual purse. Players go up one at a time."],
              ] as const
            ).map(([key, title, desc]) => (
              <button
                key={key}
                type="button"
                disabled={auction.status !== "draft"}
                onClick={() => chooseMode(key)}
                className={`rounded-xl border p-3 text-left transition disabled:opacity-60 ${mode === key ? "border-stone-900 bg-stone-50 ring-2 ring-stone-900/10" : "border-stone-200 hover:border-stone-300"}`}
              >
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-stone-500">{desc}</span>
              </button>
            ))}
          </div>
        </div>

        {mode === "league" && (
          <fieldset className="grid gap-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4 sm:grid-cols-3">
            <legend className="px-1 text-sm font-semibold">League rules</legend>
            <div>
              <label className="label">Purse per team</label>
              <input type="number" min={1} className="input" value={purse} onChange={(e) => setPurse(e.target.value)} />
            </div>
            <div>
              <label className="label">Max teams</label>
              <input type="number" min={2} max={50} className="input" value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)} />
            </div>
            <div>
              <label className="label">Squad min / max</label>
              <div className="flex gap-2">
                <input type="number" min={0} className="input" value={squadMin} onChange={(e) => setSquadMin(e.target.value)} />
                <input type="number" min={1} className="input" value={squadMax} onChange={(e) => setSquadMax(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Timer per player (sec)</label>
              <input type="number" min={5} className="input" value={lotSeconds} onChange={(e) => setLotSeconds(e.target.value)} />
            </div>
            <div>
              <label className="label">Timer after a bid (sec)</label>
              <input type="number" min={3} className="input" value={bidSeconds} onChange={(e) => setBidSeconds(e.target.value)} />
            </div>
            <div>
              <label className="label">Break between players (sec)</label>
              <input type="number" min={0} className="input" value={breakSeconds} onChange={(e) => setBreakSeconds(e.target.value)} />
            </div>
            <div>
              <label className="label">Keep back per empty min slot</label>
              <input type="number" min={0} className="input" value={minBase} onChange={(e) => setMinBase(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={hostCanPlay} onChange={(e) => setHostCanPlay(e.target.checked)} />
              Host can also own a team
            </label>
            <p className="text-xs text-stone-500 sm:col-span-3">
              Add players below as lots (their start price is the base price). Schedule the league so teams can join, then go live. Purses
              are virtual points, not real money.
            </p>
          </fieldset>
        )}

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
            <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
            Short amounts (e.g. 1.5Cr)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={chatEnabled} onChange={(e) => setChatEnabled(e.target.checked)} />
            Chat enabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allowLinks} onChange={(e) => setAllowLinks(e.target.checked)} />
            Allow links in chat
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
