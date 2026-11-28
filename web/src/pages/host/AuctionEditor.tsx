import { CalendarBlankIcon, CaretLeftIcon, ChatsCircleIcon, CheckIcon, GavelIcon, ImageIcon, InfoIcon, SparkleIcon, TrophyIcon, type Icon as PhIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, useId } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { useAuth } from "../../lib/auth";
import { supabase, errorMessage } from "../../lib/supabase";
import { auctionRole, useAuctionRoom } from "../../lib/useAuctionRoom";
import { dateTime, formatIncrements, fromLocalInput, money, parseIncrements, toLocalInput } from "../../lib/format";
import { DURATIONS, INCREMENT_PRESETS, SNIPE_WINDOWS, durationLabel } from "../../lib/templates";
import { SALE_TYPES, type SaleType } from "../../lib/saleTypes";
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
import { EmbedPanel } from "./EmbedPanel";
import { BulkPhotos } from "./BulkPhotos";
import { canDelete, deleteAuctionCompletely } from "../../lib/auctions";
import { CATEGORIES, parseTags } from "../../lib/categories";
import { confirmDialog, type ConfirmOptions } from "../../lib/confirm";
import { Toggle } from "../../components/Glass";
import { Menu } from "../../components/Menu";
import { usePageTitle } from "../../lib/usePageTitle";
import { t } from "../../lib/i18n";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED", "PTS"];

/** Remount per auction so no state (form fields, selection, tabs) leaks between auctions. */
/** Small grey help line under a settings field. */
function Hint({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-xs leading-snug font-normal text-stone-500">{children}</span>;
}

export function AuctionEditor() {
  const { id } = useParams();
  return <AuctionEditorInner key={id} />;
}

function AuctionEditorInner() {
  const { id } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const room = useAuctionRoom(id);
  const { auction, lots, media, staff, reload } = room;
  usePageTitle(auction ? t("Edit {title}", { title: auction.title }) : null);
  const role = auctionRole(auction, staff, session?.user.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  // Tabs stay mounted once opened, so unsaved settings survive a look at the lots.
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [formKey, setFormKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const onDirty = useCallback((d: boolean) => setDirty(d), []);

  if (room.loading) return <p className="text-sm text-stone-500">Loading...</p>;
  if (!auction) return <p className="text-sm text-red-600">{room.error ?? "Auction not found"}</p>;
  if (!role.canEdit && !role.canRun) return <p className="text-sm text-red-600">Only the host and co-hosts can edit this auction.</p>;

  const editable = role.canEdit && (auction.status === "draft" || auction.status === "scheduled");

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

  const live = auction.status === "live" || auction.status === "paused";
  const ended = auction.status === "ended" || auction.status === "cancelled";
  const lotWord = auction.mode === "league" ? "Players" : "Lots";
  const oneLot = auction.mode === "league" ? "player" : "lot";
  const noLots = lots.length === 0;
  const tabs: { key: EditorTab; label: string; show: boolean }[] = [
    { key: "lots", label: `${lotWord} (${lots.length})`, show: true },
    { key: "details", label: "Details & rules", show: role.canEdit },
    { key: "sharing", label: "Sharing & team", show: true },
    { key: "results", label: "Results", show: role.owner && auction.status !== "draft" },
  ];
  const fallback: EditorTab = (live || ended) && role.owner ? "results" : "lots";
  const asked = params.get("tab") as EditorTab | null;
  const tab: EditorTab = tabs.some((x) => x.key === asked && x.show) ? asked! : fallback;
  if (!opened.has(tab)) setOpened((o) => new Set(o).add(tab));
  const welcome = params.get("welcome") === "1";
  const dismissWelcome = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete("welcome");
        return n;
      },
      { replace: true, preventScrollReset: true },
    );
  const withoutPhotos = lots.filter((l) => !(media.get(l.id)?.length)).length;
  const go = (key: EditorTab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("tab", key);
        return n;
      },
      // Switching tabs keeps your place on the page.
      { replace: true, preventScrollReset: true },
    );
  const goLive = () => void rpc("start_auction", { title: "Go live now?", body: "Lots open for bidding immediately.", confirmLabel: "Go live" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/host" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
          <CaretLeftIcon size={16} weight="bold" aria-hidden="true" />
          Dashboard
        </Link>
        <AuctionBadge status={auction.status} />
        {role.cohost && <span className="chip bg-sky-100 text-sky-800">Co-host</span>}
      </div>

      {/* Title and the actions that matter right now; rare or destructive ones live under More. */}
      <div className="-mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="page-title min-w-0 break-words">{auction.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/a/${auction.id}`} className={live ? "btn-accent" : "btn-ghost"}>
            {live ? "Run the room" : "Open room"}
          </Link>
          {role.canRun && auction.status === "draft" && (
            <button className="btn-ghost" disabled={noLots} title={noLots ? `Add a ${oneLot} first` : undefined} onClick={() => void rpc("schedule_auction")}>
              Schedule
            </button>
          )}
          {role.canRun && auction.status === "scheduled" && (
            <button className="btn-ghost" onClick={() => void rpc("unschedule_auction")}>
              Back to draft
            </button>
          )}
          {role.canRun && (auction.status === "draft" || auction.status === "scheduled") && (
            <button className="btn-accent" disabled={noLots} title={noLots ? `Add a ${oneLot} first` : undefined} onClick={goLive}>
              Go live now
            </button>
          )}
          <Menu
            label="More auction actions"
            items={[
              { label: "Duplicate", onSelect: () => void duplicate(), hidden: !role.owner },
              {
                label: "Cancel auction",
                danger: true,
                hidden: !role.owner || ["draft", "ended", "cancelled"].includes(auction.status),
                onSelect: () =>
                  void rpc("cancel_auction", { title: "Cancel this auction?", body: "All open lots are withdrawn.", confirmLabel: "Cancel auction", cancelLabel: "Keep", danger: true }),
              },
              { label: "Delete", danger: true, hidden: !role.owner || !canDelete(auction.status), onSelect: () => void remove() },
            ]}
          />
        </div>
      </div>

      {error && <p className="rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-2xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">{notice}</p>}

      {/* Before it starts: what's done and what's left, one click each. */}
      {(auction.status === "draft" || auction.status === "scheduled") && role.canEdit && (
        <ol className="grid gap-2 sm:grid-cols-3" aria-label="Setup steps">
          <Step n={1} done label="Name and rules" hint="Defaults work. Change timing, currency or chat if you like." onClick={() => go("details")} />
          <Step
            n={2}
            done={!noLots}
            label={noLots ? `Add ${lotWord.toLowerCase()}` : `${lots.length} ${lots.length === 1 ? oneLot : lotWord.toLowerCase()} ready`}
            hint={noLots ? "Type them in, or import a CSV file." : "Add photos so bidders see what they get."}
            onClick={() => go("lots")}
          />
          <Step
            n={3}
            done={auction.status === "scheduled"}
            label={auction.status === "scheduled" ? "Scheduled" : "Go live"}
            hint={noLots ? `Needs at least one ${oneLot}.` : "Start bidding now, or set a start time and schedule."}
            onClick={role.canRun && !noLots ? goLive : () => go("lots")}
          />
        </ol>
      )}

      <div className="sticky top-[4.75rem] z-20 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="glass segmented scrollbar-none max-w-full overflow-x-auto" role="tablist" aria-label="Auction sections">
          {tabs
            .filter((x) => x.show)
            .map((x) => (
              <button key={x.key} role="tab" aria-selected={tab === x.key} className={`tab ${tab === x.key ? "tab-active" : ""}`} onClick={() => go(x.key)}>
                {x.label}
                {x.key === "details" && dirty && (
                  <span className="ml-1 inline-block h-2 w-2 rounded-full bg-brand-500" title="Unsaved changes" aria-label="(unsaved changes)" />
                )}
              </button>
            ))}
        </div>
      </div>

      {opened.has("lots") && (
        <section hidden={tab !== "lots"} className="animate-tab space-y-4" aria-label={lotWord}>
          {welcome && (
            <div className="card flex flex-wrap items-start gap-3 border-brand-300 bg-brand-50/80 p-5 dark:bg-brand-500/[0.08]">
              <SparkleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Your auction is set up</p>
                <p className="mt-0.5 text-sm text-stone-700">
                  Add your first {oneLot} below: a title and a price are enough. Photos help it sell. Rules can be changed any time under Details &amp; rules.
                </p>
              </div>
              <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={dismissWelcome}>
                Got it
              </button>
            </div>
          )}
          {!editable && <p className="text-sm text-stone-500">Lot details lock once the auction starts. You can still add photos.</p>}
          {editable && noLots && !welcome && (
            <div className="card p-5">
              <p className="font-semibold">No {lotWord.toLowerCase()} yet</p>
              <p className="mt-1 text-sm text-stone-600">Add the first one below, or import many at once from a CSV file.</p>
            </div>
          )}
          {!noLots && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm text-stone-600">
              <span className="font-semibold text-stone-800">
                {lots.length} {lots.length === 1 ? oneLot : lotWord.toLowerCase()}
              </span>
              <span>Start prices total {money(lots.reduce((n, l) => n + Number(l.start_price), 0), auction.settings)}</span>
              {withoutPhotos > 0 ? (
                <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                  <ImageIcon size={16} weight="bold" aria-hidden="true" />
                  {withoutPhotos} without a photo
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <ImageIcon size={16} weight="bold" aria-hidden="true" />
                  All have photos
                </span>
              )}
            </div>
          )}
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
          {/* Many at once: side by side, so they read as two options, not two more walls of form. */}
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {editable && <ImportLots auction={auction} nextPosition={lots.length} onDone={reload} />}
            {role.canEdit && <BulkPhotos auction={auction} lots={lots} media={media} editable={editable} onDone={reload} />}
          </div>
        </section>
      )}

      {opened.has("details") && role.canEdit && (
        <div hidden={tab !== "details"} className="animate-tab">
          <AuctionForm
            key={formKey}
            auction={auction}
            onSaved={async (msg) => {
              setNotice(msg);
              await reload();
            }}
            onError={setError}
            onDirty={onDirty}
            onDiscard={() => {
              setFormKey((k) => k + 1);
              setNotice(null);
            }}
          />
        </div>
      )}

      {opened.has("sharing") && (
        <div hidden={tab !== "sharing"} className="animate-tab grid gap-6 lg:grid-cols-2 3xl:grid-cols-3">
          {role.owner && <VisibilityPanel auction={auction} onChanged={reload} />}
          {role.owner && <ModeratorsPanel auction={auction} onChanged={reload} />}
          <EmbedPanel auction={auction} />
        </div>
      )}

      {opened.has("results") && role.owner && auction.status !== "draft" && (
        <div hidden={tab !== "results"} className="animate-tab">
          <AnalyticsPanel auction={auction} />
        </div>
      )}
    </div>
  );
}

type EditorTab = "lots" | "details" | "sharing" | "results";

/** One setup step: a numbered card that jumps to where the step is done. */
function Step({ n, done, label, hint, onClick }: { n: number; done: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="card flex h-full w-full items-start gap-3 p-4 text-left transition hover:-translate-y-0.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-emerald-500 text-white" : "bg-brand-100 text-brand-800"}`}
          aria-hidden="true"
        >
          {done ? <CheckIcon size={16} weight="bold" /> : n}
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">{label}</span>
          <span className="block text-sm text-stone-600">{hint}</span>
        </span>
        {done && <span className="sr-only">(done)</span>}
      </button>
    </li>
  );
}

/** A titled block of settings, so the long form reads as a few short ones. */
function Section({ icon: Glyph, title, desc, children, tone }: { icon: PhIcon; title: string; desc: string; children: ReactNode; tone?: string }) {
  return (
    <section className={`card space-y-5 p-5 sm:p-6 ${tone ?? ""}`}>
      <header className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
          <Glyph size={20} weight="bold" aria-hidden="true" />
        </span>
        <span>
          <h2 className="section-title">{title}</h2>
          <p className="text-sm text-stone-500">{desc}</p>
        </span>
      </header>
      {children}
    </section>
  );
}

/** Tap-to-pick values with an "Other" box for anything else. */
function ChipPicker({
  label,
  id,
  value,
  onChange,
  options,
  unit,
  min,
  max,
  describe,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: number; label: string }[];
  unit: string;
  min: number;
  max: number;
  describe?: (n: number) => string;
}) {
  const n = Number(value);
  const known = options.some((o) => o.value === n);
  const [other, setOther] = useState(!known);
  return (
    <fieldset>
      <legend className="label" id={`${id}-label`}>
        {label}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = !other && n === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => (onChange(String(o.value)), setOther(false))}
              className={`chip min-h-10 border px-4 text-sm ${on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-stone-900/[0.1] bg-white/60 text-stone-700 dark:bg-snow/[0.04]"}`}
            >
              {o.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={other}
          onClick={() => setOther(true)}
          className={`chip min-h-10 border px-4 text-sm ${other ? "border-brand-500 bg-brand-50 text-brand-800" : "border-stone-900/[0.1] bg-white/60 text-stone-700 dark:bg-snow/[0.04]"}`}
        >
          Other
        </button>
      </div>
      {other && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          <input id={id} type="number" min={min} max={max} className="input w-28" aria-labelledby={`${id}-label`} value={value} onChange={(e) => onChange(e.target.value)} />
          {unit}
          {describe && Number(value) > 0 && <span className="text-stone-500">({describe(Number(value))})</span>}
        </div>
      )}
    </fieldset>
  );
}

function AuctionForm({
  auction,
  onSaved,
  onError,
  onDirty,
  onDiscard,
}: {
  auction: Auction;
  onSaved: (msg: string) => Promise<void>;
  onError: (msg: string | null) => void;
  /** Tells the editor about unsaved changes (it marks the tab). */
  onDirty: (dirty: boolean) => void;
  /** Throws the edits away (the editor remounts the form from the saved auction). */
  onDiscard: () => void;
}) {
  const fid = useId();
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
  const [customBids, setCustomBids] = useState(s.custom_bids !== false);
  const [saleType, setSaleType] = useState<SaleType>(s.default_sale_type ?? "english");
  const [purse, setPurse] = useState(String(lg.purse));
  const [squadMin, setSquadMin] = useState(String(lg.squad_min));
  const [squadMax, setSquadMax] = useState(String(lg.squad_max));
  const [maxTeams, setMaxTeams] = useState(String(lg.max_teams));
  const [lotSeconds, setLotSeconds] = useState(String(lg.lot_seconds));
  const [bidSeconds, setBidSeconds] = useState(String(lg.bid_seconds));
  const [breakSeconds, setBreakSeconds] = useState(String(lg.break_seconds));
  const [minBase, setMinBase] = useState(String(lg.min_base));
  const [hostCanPlay, setHostCanPlay] = useState(lg.host_can_play);
  const [retainMax, setRetainMax] = useState(String(s.league?.retain_max ?? 4));
  const [rtmCards, setRtmCards] = useState(String(s.league?.rtm_cards ?? 0));
  const [rtmSeconds, setRtmSeconds] = useState(String(s.league?.rtm_seconds ?? 20));
  const [trades, setTrades] = useState(s.league?.trades ?? true);
  const [tradeDeadline, setTradeDeadline] = useState(toLocalInput(s.league?.trade_deadline ?? null));
  const [categoryMax, setCategoryMax] = useState(
    Object.entries(s.league?.category_max ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(", "),
  );
  const [busy, setBusy] = useState(false);
  // The league's rarely changed rules start open only when one of them was changed.
  const [moreLeague] = useState(
    () =>
      lg.min_base !== LEAGUE_DEFAULTS.min_base ||
      Boolean(lg.host_can_play) ||
      (s.league?.retain_max ?? 4) !== 4 ||
      (s.league?.rtm_cards ?? 0) > 0 ||
      s.league?.trades === false ||
      Boolean(s.league?.trade_deadline) ||
      Object.keys(s.league?.category_max ?? {}).length > 0,
  );

  // Unsaved changes: everything the form holds, compared with what was last saved.
  const current = JSON.stringify([
    title, description, startsAt, endsAt, streamUrl, category, tags, currency, antiSnipe, duration, stagger, chatEnabled, allowLinks, slowMode,
    increments, mode, compact, customBids, saleType, purse, squadMin, squadMax, maxTeams, lotSeconds, bidSeconds, breakSeconds, minBase,
    hostCanPlay, retainMax, rtmCards, rtmSeconds, trades, tradeDeadline, categoryMax,
  ]);
  const baseline = useRef<string | null>(null);
  if (baseline.current === null) baseline.current = current;
  const [, markSaved] = useState(0);
  const dirty = current !== baseline.current;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  // Leaving with unsaved changes: the browser asks on close or reload, the app asks on navigation.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    let settled = false;
    void confirmDialog({ title: "Leave without saving?", body: "Your changes to this auction's settings will be lost.", confirmLabel: "Leave", cancelLabel: "Stay", danger: true }).then((leave) => {
      if (settled) return;
      settled = true;
      if (leave) blocker.proceed?.();
      else blocker.reset?.();
    });
    return () => {
      settled = true;
    };
    // Only when a navigation is blocked; the blocker object itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  function chooseMode(next: "standard" | "league") {
    setMode(next);
    if (next === "league") {
      setCompact(true);
      if (increments === formatIncrements(DEFAULT_INCREMENTS)) setIncrements(formatIncrements(LEAGUE_INCREMENTS));
    }
  }

  const parsedInc = parseIncrements(increments);
  const preset = INCREMENT_PRESETS.find((p) => formatIncrements(p.table) === increments)?.key ?? "custom";
  const [customInc, setCustomInc] = useState(preset === "custom");
  const money$ = (n: number) => money(n, { currency, compact });

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
      lot_duration_minutes: Math.min(10080, Math.max(1, Number(duration) || 10)),
      lot_stagger_seconds: Math.max(0, Number(stagger) || 0),
      chat: { enabled: chatEnabled, slow_mode_s: Math.max(0, Number(slowMode) || 0), allow_links: allowLinks },
      compact,
      custom_bids: customBids,
      default_sale_type: saleType,
      league: {
        // Keep settings edited elsewhere (scoring rules, captain multipliers).
        ...auction.settings.league,
        purse: Math.max(1, Number(purse) || LEAGUE_DEFAULTS.purse),
        squad_min: Math.max(0, Number(squadMin) || 0),
        squad_max: Math.max(1, Number(squadMax) || LEAGUE_DEFAULTS.squad_max),
        max_teams: Math.max(2, Number(maxTeams) || LEAGUE_DEFAULTS.max_teams),
        lot_seconds: Math.max(5, Number(lotSeconds) || LEAGUE_DEFAULTS.lot_seconds),
        bid_seconds: Math.max(3, Number(bidSeconds) || LEAGUE_DEFAULTS.bid_seconds),
        break_seconds: Math.max(0, Number(breakSeconds) || 0),
        min_base: Math.max(0, Number(minBase) || 0),
        host_can_play: hostCanPlay,
        retain_max: Math.max(0, Number(retainMax) || 0),
        rtm_cards: Math.max(0, Number(rtmCards) || 0),
        rtm_seconds: Math.min(120, Math.max(5, Number(rtmSeconds) || 20)),
        trades,
        trade_deadline: fromLocalInput(tradeDeadline) ?? undefined,
        category_max: Object.fromEntries(
          categoryMax
            .split(",")
            .map((part) => part.split(":").map((x) => x.trim()))
            .filter(([k, v]) => k && Number(v) > 0)
            .map(([k, v]) => [k, Math.floor(Number(v))]),
        ),
        ...(s.league?.season ? { season: s.league.season } : {}),
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
    if (error) return onError(errorMessage(error));
    baseline.current = current;
    markSaved((n) => n + 1);
    await onSaved("Auction saved");
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

  const minutes = Number(duration) || 0;
  const staggerS = Number(stagger) || 0;
  const scheduleSummary =
    mode === "league"
      ? null
      : endsAt
        ? `Every lot closes at ${dateTime(fromLocalInput(endsAt))}${staggerS ? `, then each next one ${staggerS}s later` : ""}.`
        : `Each lot takes bids for ${durationLabel(minutes)} once it opens${staggerS ? `, and each next lot closes ${staggerS >= 60 && staggerS % 60 === 0 ? `${staggerS / 60} min` : `${staggerS}s`} later than the one before` : ", and they all close together"}.`;

  return (
    <form id="auction-form" onSubmit={save} onInvalidCapture={(e) => (e.target as HTMLElement).closest("details")?.setAttribute("open", "")} className="space-y-5 pb-24">
      <Section icon={InfoIcon} title="Basics" desc="What it's called, what's on offer, and the picture people see first.">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="t">
                Title
              </label>
              <input id="t" className="input" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
              <Hint>Shown on the home page, in search and on shared links.</Hint>
            </div>
            <div>
              <label className="label" htmlFor="d">
                Description
              </label>
              <textarea id="d" className="input min-h-28" maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
              <Hint>What people are bidding on, rules, pickup or delivery. Shown above the lots.</Hint>
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
                <Hint>Puts the auction under this heading on the home page.</Hint>
              </div>
              <div>
                <label className="label" htmlFor="tags">
                  Tags (comma separated, up to 8)
                </label>
                <input id="tags" className="input" placeholder="vintage, silver, 1970s" value={tags} onChange={(e) => setTags(e.target.value)} />
                <Hint>Help people find it in search and themed events.</Hint>
              </div>
            </div>
          </div>
          <div>
            <p className="label">Cover image</p>
            <div className="aspect-[16/9] overflow-hidden rounded-2xl bg-stone-900/[0.05] dark:bg-snow/[0.05]">
              {auction.cover_url ? (
                <img src={auction.cover_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-stone-500">No cover yet. Auctions with a picture get more visits.</div>
              )}
            </div>
            <label className="btn-ghost mt-3 w-full cursor-pointer">
              {auction.cover_url ? "Change cover" : "Upload cover"}
              <input type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && void cover(e.target.files[0])} />
            </label>
            <Hint>Saved straight away. Wide pictures (16:9) look best.</Hint>
          </div>
        </div>

        <div>
          <p className="label">Auction type</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["standard", "Standard auction", "Many lots, timed or host-run. Real bids from anyone."],
                ["league", "Team league (IPL-style)", "Teams join with a virtual purse. Players go up one at a time."],
              ] as const
            ).map(([key, label, desc]) => (
              <button
                key={key}
                type="button"
                disabled={auction.status !== "draft"}
                onClick={() => chooseMode(key)}
                aria-pressed={mode === key}
                className={`choice ${mode === key ? "choice-on" : ""}`}
              >
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-stone-500">{desc}</span>
              </button>
            ))}
          </div>
          {auction.status !== "draft" && <Hint>The type is fixed once the auction is scheduled or running.</Hint>}
        </div>
      </Section>

      <Section icon={CalendarBlankIcon} title="Schedule" desc="When bidding starts and how long each lot stays open.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sa">
              Starts at
            </label>
            <input id="sa" type="datetime-local" className="input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            <Hint>When it goes live by itself after you schedule. Leave empty to start by hand with Go live.</Hint>
          </div>
          {mode !== "league" && (
            <div>
              <label className="label" htmlFor="ea">
                All lots close at (optional)
              </label>
              <input id="ea" type="datetime-local" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              <Hint>One closing time for every lot. Empty: each lot closes after the length below.</Hint>
            </div>
          )}
        </div>
        {mode !== "league" && (
          <>
            {!endsAt && (
              <ChipPicker
                label="How long each lot takes bids"
                id="du"
                value={duration}
                onChange={setDuration}
                options={DURATIONS.map((d) => ({ value: d.minutes, label: d.label }))}
                unit="minutes"
                min={1}
                max={10080}
                describe={durationLabel}
              />
            )}
            <ChipPicker
              label="Close lots one after another"
              id="st"
              value={stagger}
              onChange={setStagger}
              options={[
                { value: 0, label: "No, together" },
                { value: 30, label: "30s apart" },
                { value: 60, label: "1 min apart" },
                { value: 120, label: "2 min apart" },
                { value: 300, label: "5 min apart" },
              ]}
              unit="seconds apart"
              min={0}
              max={86400}
            />
            {scheduleSummary && <p className="rounded-2xl bg-stone-900/[0.04] px-3.5 py-2.5 text-sm text-stone-700 dark:bg-snow/[0.05]">{scheduleSummary}</p>}
          </>
        )}
      </Section>

      {mode === "league" && (
        <Section icon={TrophyIcon} title="League rules" desc="Purses, squads and the clock for each player." tone="bg-violet-50/80 dark:bg-violet-500/[0.06]">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor={`${fid}-0`} className="label">Purse per team</label>
              <input id={`${fid}-0`} type="number" min={1} className="input" value={purse} onChange={(e) => setPurse(e.target.value)} />
              <Hint>Virtual points each team gets to spend on players: {money$(Number(purse) || 0)}.</Hint>
            </div>
            <div>
              <label htmlFor={`${fid}-1`} className="label">Max teams</label>
              <input id={`${fid}-1`} type="number" min={2} max={50} className="input" value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)} />
              <Hint>Joining stops once this many teams are in.</Hint>
            </div>
            <div>
              <label htmlFor={`${fid}-2`} className="label">Squad min / max</label>
              <div className="flex gap-2">
                <input id={`${fid}-2`} type="number" min={0} className="input" aria-label="Squad minimum" value={squadMin} onChange={(e) => setSquadMin(e.target.value)} />
                <input type="number" min={1} className="input" aria-label="Squad maximum" value={squadMax} onChange={(e) => setSquadMax(e.target.value)} />
              </div>
              <Hint>Fewest and most players a team can buy. A full squad stops bidding.</Hint>
            </div>
            <div>
              <label htmlFor={`${fid}-3`} className="label">Timer per player (sec)</label>
              <input id={`${fid}-3`} type="number" min={5} className="input" value={lotSeconds} onChange={(e) => setLotSeconds(e.target.value)} />
              <Hint>How long a player stays on the block if nobody bids.</Hint>
            </div>
            <div>
              <label htmlFor={`${fid}-4`} className="label">Timer after a bid (sec)</label>
              <input id={`${fid}-4`} type="number" min={3} className="input" value={bidSeconds} onChange={(e) => setBidSeconds(e.target.value)} />
              <Hint>Each bid resets the clock to this, so others can answer.</Hint>
            </div>
            <div>
              <label htmlFor={`${fid}-5`} className="label">Break between players (sec)</label>
              <input id={`${fid}-5`} type="number" min={0} className="input" value={breakSeconds} onChange={(e) => setBreakSeconds(e.target.value)} />
              <Hint>Pause before the next player comes up.</Hint>
            </div>
          </div>
          <details className="rounded-2xl bg-white/50 px-4 py-3 dark:bg-snow/[0.03]" open={moreLeague}>
            <summary className="cursor-pointer text-sm font-semibold text-stone-700">
              More league rules <span className="font-normal text-stone-500">: purse rules, retentions, right to match, category limits, trades</span>
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor={`${fid}-6`} className="label">Keep back per empty min slot</label>
                <input id={`${fid}-6`} type="number" min={0} className="input" value={minBase} onChange={(e) => setMinBase(e.target.value)} />
                <Hint>Purse a team must keep for each squad slot it still has to fill, so it can reach the minimum.</Hint>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium sm:col-span-2">
                <span>
                  Host can also own a team
                  <Hint>Lets you join with your own team and bid like everyone else.</Hint>
                </span>
                <Toggle checked={hostCanPlay} onChange={(v) => setHostCanPlay(v)} />
              </label>
              <div>
                <label htmlFor={`${fid}-7`} className="label">Retentions per team</label>
                <input id={`${fid}-7`} type="number" min={0} className="input" value={retainMax} onChange={(e) => setRetainMax(e.target.value)} />
                <Hint>Players a team can keep from last season before the auction.</Hint>
              </div>
              <div>
                <label htmlFor={`${fid}-8`} className="label">Right-to-match cards per team</label>
                <input id={`${fid}-8`} type="number" min={0} className="input" value={rtmCards} onChange={(e) => setRtmCards(e.target.value)} />
                <Hint>Lets a team match the winning bid for its former player and take that player back.</Hint>
              </div>
              <div>
                <label htmlFor={`${fid}-9`} className="label">Time to match (sec)</label>
                <input id={`${fid}-9`} type="number" min={5} max={120} className="input" value={rtmSeconds} onChange={(e) => setRtmSeconds(e.target.value)} />
                <Hint>How long a team has to use its right-to-match card.</Hint>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`${fid}-10`} className="label">Category limits per team</label>
                <input id={`${fid}-10`} className="input" placeholder="Overseas: 8, Wicket-keeper: 2" value={categoryMax} onChange={(e) => setCategoryMax(e.target.value)} />
                <Hint>Give players a "Category: Overseas" line in their details.</Hint>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
                <span>
                  Allow trades
                  <Hint>Teams can swap players with each other after buying them.</Hint>
                </span>
                <Toggle checked={trades} onChange={(v) => setTrades(v)} />
              </label>
              <div>
                <label className="label" htmlFor="tdl">
                  Trade deadline (optional)
                </label>
                <input id="tdl" type="datetime-local" className="input" value={tradeDeadline} onChange={(e) => setTradeDeadline(e.target.value)} />
                <Hint>After this, trades between teams are blocked.</Hint>
              </div>
            </div>
          </details>
          <p className="text-xs text-stone-500">
            Add players as lots (their start price is the base price). Schedule the league so teams can join, then go live. Purses are virtual points, not real money.
          </p>
        </Section>
      )}

      <Section icon={GavelIcon} title="Bidding" desc="How people bid and how prices move.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cur">
              Currency
            </label>
            <select id="cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c === "PTS" ? "PTS (points, no money)" : c}
                </option>
              ))}
            </select>
            <Hint>Every price in this auction uses it.</Hint>
          </div>
          {mode !== "league" && (
            <div>
              <label className="label" htmlFor="sale">
                New lots start as
              </label>
              <select id="sale" className="input" value={saleType} onChange={(e) => setSaleType(e.target.value as SaleType)}>
                {SALE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Hint>{SALE_TYPES.find((t) => t.value === saleType)?.help} Each lot can still use another type.</Hint>
            </div>
          )}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
          <span>
            Custom bid amounts
            <Hint>On: bidders can type any amount or jump ahead, and set an auto-bid. Off: one button that bids the next step only.</Hint>
          </span>
          <Toggle checked={customBids} onChange={(v) => setCustomBids(v)} />
        </label>
        {mode !== "league" && (
          <ChipPicker
            label="Anti-snipe: a late bid adds"
            id="as"
            value={antiSnipe}
            onChange={setAntiSnipe}
            options={SNIPE_WINDOWS.map((w) => ({ value: w.seconds, label: w.label }))}
            unit="seconds"
            min={0}
            max={600}
          />
        )}
        <div>
          <label className="label" htmlFor="incp">
            Bid steps
          </label>
          <select
            id="incp"
            className="input sm:w-80"
            value={customInc ? "custom" : preset}
            onChange={(e) => {
              const p = INCREMENT_PRESETS.find((x) => x.key === e.target.value);
              if (p) {
                setIncrements(formatIncrements(p.table));
                setCustomInc(false);
              } else setCustomInc(true);
            }}
          >
            {INCREMENT_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom">My own steps</option>
          </select>
          {customInc && (
            <>
              <input id="inc" className="input mt-2 font-mono" aria-label="Bid steps, from amount : step" value={increments} onChange={(e) => setIncrements(e.target.value)} />
              <Hint>"0:10, 1000:50" means steps of 10 below 1,000, then 50.</Hint>
            </>
          )}
          {parsedInc ? (
            <ul className="mt-2 flex flex-wrap gap-1.5 text-xs text-stone-600" aria-label="Bid steps preview">
              {parsedInc.map(([from, step], i) => (
                <li key={from} className="rounded-full bg-stone-900/[0.05] px-2.5 py-1 tabular-nums dark:bg-snow/[0.06]">
                  {i === 0 ? "From the start" : `From ${money$(from)}`}: +{money$(step)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs font-medium text-red-600">Use "from : step" pairs, like 0:10, 1000:50.</p>
          )}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
          <span>
            Short amounts (e.g. 1.5Cr)
            <Hint>Shows big prices short, like 1.5Cr or 20L, instead of every digit.</Hint>
          </span>
          <Toggle checked={compact} onChange={(v) => setCompact(v)} />
        </label>
      </Section>

      <Section icon={ChatsCircleIcon} title="Room" desc="Chat and live video next to the bidding.">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
          <span>
            Chat
            <Hint>Live chat next to the bidding. Turn off to keep the room quiet.</Hint>
          </span>
          <Toggle checked={chatEnabled} onChange={(v) => setChatEnabled(v)} />
        </label>
        {chatEnabled && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="sm">
                Slow mode (seconds between messages)
              </label>
              <input id="sm" type="number" min={0} max={300} className="input" value={slowMode} onChange={(e) => setSlowMode(e.target.value)} />
              <Hint>Wait between messages from the same person. 0 turns it off.</Hint>
            </div>
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm font-medium">
              <span>
                Allow links in chat
                <Hint>Off blocks web links in messages, which stops most spam.</Hint>
              </span>
              <Toggle checked={allowLinks} onChange={(v) => setAllowLinks(v)} />
            </label>
          </div>
        )}
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
          <Hint>Embeds your video next to the bidding, so viewers can watch and bid together.</Hint>
        </div>
      </Section>

      <div className="flex justify-end">
        <button className="btn-primary px-6" disabled={busy || !dirty}>
          {dirty ? "Save auction" : "All changes saved"}
        </button>
      </div>

      {/* Unsaved changes stay in view while you scroll. */}
      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="glass mx-auto flex max-w-2xl animate-rise flex-wrap items-center gap-3 rounded-[24px] px-4 py-3">
            <span className="min-w-0 flex-1 text-sm font-semibold">You have unsaved changes</span>
            <button type="button" className="btn-ghost" disabled={busy} onClick={onDiscard}>
              Discard
            </button>
            <button type="submit" className="btn-accent" disabled={busy}>
              {busy ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
