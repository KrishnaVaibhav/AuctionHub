import { useEffect, useRef, useState } from "react";
import { CaretLeftIcon, CaretRightIcon, WifiSlashIcon } from "@phosphor-icons/react";
import { Link, useParams, useSearchParams } from "react-router";
import { useAuth } from "../lib/auth";
import { auctionRole, useAuctionRoom } from "../lib/useAuctionRoom";
import { BidReplay } from "../components/BidReplay";
import { supabase, errorMessage } from "../lib/supabase";
import { dateTime, money } from "../lib/format";
import { minNextBid } from "../lib/bidding";
import { useCloseDue } from "../lib/useCloseDue";
import { useQuickBid, type QuickBidState } from "../lib/useQuickBid";
import { useProfileNames } from "../lib/profiles";
import { publicUrl } from "../lib/media";
import type { Auction, Lot, LotMedia } from "../lib/types";
import { AuctionBadge, LotBadge } from "../components/StatusBadge";
import { BidPanel } from "../components/BidPanel";
import { DesktopChat, FloatingChat } from "../components/FloatingChat";
import { LotGallery } from "../components/LotGallery";
import { StreamEmbed } from "../components/StreamEmbed";
import { Countdown } from "../components/Countdown";
import { BidLog } from "../components/BidLog";
import { Results } from "../components/Results";
import { LeagueRoom } from "../components/league/LeagueRoom";
import { PrivateGate } from "../components/PrivateGate";
import { visibilityLabel } from "../lib/auctions";
import { useIsAdmin } from "../lib/admin";
import { WatchButton } from "../components/WatchButton";
import { HostLine } from "../components/HostLine";
import { PriceHint } from "../components/PriceHint";
import { t } from "../lib/i18n";
import { confirmDialog, type ConfirmOptions } from "../lib/confirm";
import { useLivePulse } from "../lib/useLivePulse";
import { funOn, sounds } from "../lib/fun";
import { LiveStage } from "../components/live/LiveStage";
import { SoldMoment } from "../components/live/SoldMoment";
import { Reactions } from "../components/live/Reactions";
import { GuessLeaderboard, GuessPanel } from "../components/live/Predictions";
import { BingoCard } from "../components/live/BingoCard";
import { WatchParty } from "../components/live/WatchParty";
import { HostRoomControls } from "../components/live/HostRoomControls";
import { usePageTitle } from "../lib/usePageTitle";
import { useOnline } from "../lib/useOnline";

type Tab = "lot" | "lots" | "bids" | "results" | "games" | "party" | "replay" | "chat";

/** Remount per auction so no state (form fields, selection, tabs) leaks between auctions. */
export function AuctionRoom() {
  const { id } = useParams();
  return <AuctionRoomInner key={id} />;
}

function AuctionRoomInner() {
  const { id } = useParams();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { auction, lots, media, moderatorIds, staff, loading, error, connected, reload } = useAuctionRoom(id);
  const online = useOnline();
  usePageTitle(auction?.title);
  const [params, setParams] = useSearchParams();
  // ?lot= opens that lot (links from notifications and My bids), and follows the selection.
  const [selectedId, setSelectedId] = useState<string | null>(params.get("lot"));
  const [tab, setTab] = useState<Tab>((["lot", "lots", "bids", "results", "games", "party", "replay", "chat"] as Tab[]).find((t) => t === params.get("tab") && t !== "chat") ?? "lot");
  const [hostError, setHostError] = useState<string | null>(null);
  const { isAdmin } = useIsAdmin();
  const events = useLivePulse(lots);
  const live = auction?.status === "live";
  const quick = useQuickBid(auction);
  // Close a lot the moment its clock runs out, rather than at the next scheduler run.
  useCloseDue(auction, lots);

  useEffect(() => {
    if (!selectedId || params.get("lot") === selectedId) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set("lot", selectedId);
        return next;
      },
      // Picking a lot only records it in the address: stay where you are on the page.
      { replace: true, preventScrollReset: true },
    );
  }, [selectedId, params, setParams]);

  // The host's spotlight opens that lot on every screen. A link to one lot
  // (an outbid alert, My bids) wins over the spotlight that was already on
  // when the page opened; any spotlight the host sets after that applies.
  const spotlight = auction?.spotlight_lot_id ?? null;
  const deepLinked = useRef(Boolean(params.get("lot")));
  const loaded = Boolean(auction);
  useEffect(() => {
    if (loaded && !spotlight) deepLinked.current = false;
  }, [loaded, spotlight]);
  useEffect(() => {
    if (!spotlight) return;
    if (deepLinked.current) {
      deepLinked.current = false;
      return;
    }
    setSelectedId(spotlight);
    setTab((t) => (t === "lots" || t === "bids" ? "lot" : t));
  }, [spotlight]);

  // Watching a live room earns a little XP (capped per day on the server).
  useEffect(() => {
    if (!live || !userId || !id) return;
    const tick = () => document.visibilityState === "visible" && void supabase.rpc("xp_watch", { p_auction_id: id });
    const t = setInterval(tick, 120_000);
    return () => clearInterval(t);
  }, [live, userId, id]);

  // Browsers only allow sound after a tap.
  useEffect(() => {
    const unlock = () => sounds.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  if (loading) return <RoomSkeleton />;
  // A failed load (no network, a server hiccup) is not "private" or "not found": say so and offer a retry.
  if (!auction && error) return <LoadFailed message={error} onRetry={reload} />;
  if (!auction) return id ? <PrivateGate auctionId={id} onJoined={reload} /> : null;

  const role = auctionRole(auction, staff, userId);
  // "Host" in the room means anyone allowed to run it: the owner or a co-host with Run.
  const isHost = role.canRun;
  const isTeam = role.canRun || role.canEdit;
  const isStaff = isHost || isAdmin || (userId != null && moderatorIds.includes(userId));
  const selected: Lot | undefined =
    lots.find((l) => l.id === selectedId) ?? lots.find((l) => l.id === auction.spotlight_lot_id) ?? lots.find((l) => l.status === "open") ?? lots[0];
  const selectedIndex = selected ? lots.indexOf(selected) : -1;
  const finished = auction.status === "ended" || auction.status === "cancelled";

  async function hostAction(fn: string, args: Record<string, string>, confirm?: ConfirmOptions) {
    if (confirm && !(await confirmDialog(confirm))) return;
    setHostError(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) setHostError(errorMessage(error));
  }

  // When the last open lot closes: the header counts down to it. Lots move on their
  // own (anti-snipe, the host adding time), so this follows the lots, not the auction.
  const lastClose = lots.reduce<string | null>((latest, l) => (l.status === "open" && l.ends_at && (!latest || l.ends_at > latest) ? l.ends_at : latest), null);
  const barMsg = selected && quick.msg?.lotId === selected.id ? quick.msg : null;

  const tabs: { key: Tab; label: string; mobileOnly?: boolean }[] = [
    { key: "lot", label: t("Current lot") },
    { key: "lots", label: t("All lots ({n})", { n: lots.length }) },
    { key: "bids", label: t("Bid log") },
    { key: "results", label: t(finished ? "Results" : "Standings") },
    ...(funOn(auction.settings, "guesses") || funOn(auction.settings, "bingo") ? [{ key: "games" as Tab, label: t("Games") }] : []),
    ...(funOn(auction.settings, "parties") && !finished ? [{ key: "party" as Tab, label: t("Party") }] : []),
    ...(auction.status === "ended" ? [{ key: "replay" as Tab, label: t("Replay") }] : []),
  ];

  const openLot = (lotId: string) => {
    setSelectedId(lotId);
    setTab("lot");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      {/* Header */}
      {/* While live, the header steps back so the live stage below leads. */}
      <div
        className={`aurora flex flex-col gap-4 rounded-[32px] border border-white/60 lg:flex-row lg:items-start lg:justify-between dark:border-snow/[0.06] ${
          live ? "p-4 sm:p-5" : "p-5 sm:p-7"
        }`}
      >
        <div className="enter min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AuctionBadge status={auction.status} />
            {auction.mode === "league" && <span className="chip bg-violet-100 text-violet-800">Team league</span>}
            {auction.visibility !== "public" && <span className="chip bg-stone-900 text-white">{visibilityLabel[auction.visibility]}</span>}
            {auction.status === "scheduled" && <span className="text-sm text-stone-500">Starts {dateTime(auction.starts_at)}</span>}
            {auction.status === "live" && auction.mode !== "league" && lastClose && (
              <span className="text-sm text-stone-500">
                {t("Last lot closes in")} <Countdown endsAt={lastClose} className="font-semibold text-stone-800" />
              </span>
            )}
          </div>
          <h1 className={live ? "mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-3xl" : "page-title mt-3"}>{auction.title}</h1>
          <HostLine hostId={auction.host_id} category={auction.category} />
          {auction.description && (
            <p className={`mt-2 max-w-3xl whitespace-pre-line text-sm text-stone-600 ${live ? "hidden sm:line-clamp-1" : "line-clamp-3 sm:text-base"}`}>{auction.description}</p>
          )}
        </div>

        {isHost && <HostBar auction={auction} onAction={hostAction} canEdit={role.canEdit} cohost={role.cohost} lots={lots} selected={selected} />}
      </div>
      {hostError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{hostError}</p>}

      {/* Offline is announced by the layout; this covers a dropped live connection. */}
      {!finished && online && !connected && (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-amber-100 px-4 py-2.5 text-sm font-medium text-amber-900">
          <WifiSlashIcon size={18} weight="bold" className="shrink-0" aria-hidden="true" />
          {t("Reconnecting… Prices may be a few seconds behind.")}
        </p>
      )}

      <SoldMoment auction={auction} lots={lots} events={events} userId={userId} />
      {auction.mode !== "league" && selected && (auction.status === "live" || auction.status === "paused") && (
        <LiveStage auction={auction} lot={selected} lots={lots} userId={userId} events={events} isTeam={isTeam} isHost={isHost} onSelect={setSelectedId} />
      )}
      {live && funOn(auction.settings, "reactions") && (
        <div className="flex flex-wrap items-center gap-3">
          <Reactions auctionId={auction.id} showHeat={isHost} />
        </div>
      )}

      {auction.mode === "league" ? (
        <LeagueRoom auction={auction} lots={lots} media={media} userId={userId} isHost={isHost} isOwner={role.owner} isStaff={isStaff} />
      ) : (
        <>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem] 3xl:grid-cols-[minmax(0,1fr)_30rem] 3xl:gap-8">
          <div className="min-w-0 space-y-5">
            {auction.stream_url && !finished && <StreamEmbed url={auction.stream_url} />}

            {/* Tabs */}
            <div className="sticky top-[4.75rem] z-20 -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="glass segmented scrollbar-none max-w-full overflow-x-auto">
                {tabs.map((t) => (
                  <button key={t.key} className={`tab ${tab === t.key ? "tab-active" : ""} ${t.mobileOnly ? "lg:hidden" : ""}`} onClick={() => setTab(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div key={tab} className="animate-tab space-y-5">
            {tab === "lot" &&
              (selected ? (
                <div className="grid animate-rise gap-6 md:grid-cols-2">
                  <div className="min-w-0">
                    <LotGallery items={media.get(selected.id) ?? []} title={selected.title} />
                    <div className="mt-4 flex items-start justify-between gap-3">
                      <h2 className="font-display text-2xl font-extrabold tracking-tight">
                        <span className="mr-2 text-stone-400 tabular-nums">#{selected.position + 1}</span>
                        {selected.title}
                      </h2>
                      <div className="flex shrink-0 gap-1">
                        <WatchButton lotId={selected.id} userId={userId} />
                        <button className="btn-ghost h-10 w-10 p-0" disabled={selectedIndex <= 0} onClick={() => setSelectedId(lots[selectedIndex - 1]?.id ?? null)} aria-label="Previous lot">
                          <CaretLeftIcon size={16} weight="bold" aria-hidden="true" />
                        </button>
                        <button
                          className="btn-ghost h-10 w-10 p-0"
                          disabled={selectedIndex >= lots.length - 1}
                          onClick={() => setSelectedId(lots[selectedIndex + 1]?.id ?? null)}
                          aria-label="Next lot"
                        >
                          <CaretRightIcon size={16} weight="bold" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    {selected.description && <p className="mt-2 whitespace-pre-line text-sm text-stone-600">{selected.description}</p>}
                    {Object.keys(selected.custom_fields ?? {}).length > 0 && (
                      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        {Object.entries(selected.custom_fields).map(([k, v]) => (
                          <div key={k} className="rounded-2xl bg-stone-900/[0.04] px-3.5 py-2.5 dark:bg-snow/[0.05]">
                            <dt className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">{k}</dt>
                            <dd className="font-medium">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {selected.status === "open" && <PriceHint className="mt-4" category={auction.category} title={selected.title} settings={auction.settings} />}
                    {isHost && selected.status === "open" && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button className="btn-ghost" onClick={() => void hostAction("withdraw_lot", { p_lot_id: selected.id }, { title: `Withdraw "${selected.title}"?`, body: "Bidding stops and the lot is marked withdrawn.", confirmLabel: "Withdraw lot", danger: true })}>
                          Withdraw this lot
                        </button>
                      </div>
                    )}
                  </div>
                  <div id="bid" className="scroll-mt-20 space-y-4">
                    <BidPanel auction={auction} lot={selected} userId={userId} isHost={isTeam} />
                    {selected.bid_count === 0 && selected.status !== "sold" && <GuessPanel auction={auction} lot={selected} userId={userId} isTeam={isTeam} />}
                  </div>
                </div>
              ) : (
                <div className="card py-16 text-center text-sm text-stone-500">No lots in this auction yet.</div>
              ))}

            {tab === "lots" && <LotGrid auction={auction} lots={lots} media={media} userId={userId} isTeam={isTeam} quick={quick} selectedId={selected?.id} onOpen={openLot} />}
            {tab === "bids" && <BidLog auction={auction} lots={lots} userId={userId} />}
            {tab === "replay" && <BidReplay auction={auction} lots={lots} media={media} />}
            {tab === "games" && (
              <div className="grid animate-rise gap-4 md:grid-cols-2">
                {selected && <GuessPanel auction={auction} lot={selected} userId={userId} isTeam={isTeam} />}
                <BingoCard auction={auction} lots={lots} events={events} userId={userId} />
                <div className="card space-y-3 p-4 md:col-span-2">
                  <p className="font-semibold">{t("Top guessers in this auction")}</p>
                  <GuessLeaderboard auctionId={auction.id} />
                </div>
              </div>
            )}
            {tab === "party" && <WatchParty auction={auction} userId={userId} />}
            {tab === "results" && <Results auction={auction} lots={lots} isHost={role.owner} userId={userId} />}
            </div>
          </div>

          <DesktopChat auction={auction} userId={userId} isStaff={isStaff} />
        </div>

        {/* Mobile sticky bid bar */}
        <FloatingChat
          auction={auction}
          userId={userId}
          isStaff={isStaff}
          startOpen={params.get("tab") === "chat"}
          lift={Boolean(selected && selected.status === "open" && auction.status === "live")}
        />
        {selected && selected.status === "open" && auction.status === "live" && (
          <div className="fixed inset-x-0 bottom-0 z-20 px-3 lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <div className="glass mx-auto max-w-xl animate-rise rounded-[28px] px-4 py-3">
            <div className="mx-auto flex max-w-xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-stone-500">
                  #{selected.position + 1} {selected.title}
                </p>
                <p className="flex items-baseline gap-2">
                  <span key={String(selected.current_bid)} className="animate-bump rounded-md font-display text-lg font-extrabold tabular-nums">{money(selected.current_bid ?? selected.start_price, auction.settings)}</span>
                  <Countdown endsAt={selected.ends_at} className="text-sm" />
                </p>
              </div>
              {!isTeam && (
                <button
                  className="btn-ghost h-11 px-3"
                  aria-label={t("More bid options")}
                  onClick={() => {
                    setTab("lot");
                    setTimeout(() => document.getElementById("bid")?.scrollIntoView({ behavior: "smooth" }), 50);
                  }}
                >
                  {t("Options")}
                </button>
              )}
              {userId && selected.current_winner_id === userId ? (
                <span className="chip min-h-11 bg-emerald-100 px-4 text-emerald-800">{t("Winning")}</span>
              ) : (
                !isTeam &&
                (userId && selected.sale_type === "english" ? (
                  <button className="btn-accent min-h-11 px-5" disabled={quick.busyId === selected.id} onClick={() => void quick.bid(selected)}>
                    {quick.busyId === selected.id ? t("Bidding...") : t("Bid {amount}", { amount: money(minNextBid(selected, auction.settings), auction.settings) })}
                  </button>
                ) : userId ? null : (
                  <Link to={`/login?next=/a/${auction.id}`} className="btn-accent min-h-11 px-5">
                    {t("Sign in to bid")}
                  </Link>
                ))
              )}
            </div>
            <p role="status" aria-live="polite" className={`mx-auto max-w-xl text-xs font-medium empty:hidden ${barMsg?.ok ? "text-emerald-700" : "text-red-600"}`}>
              {barMsg?.text}
            </p>
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
}

function HostBar({
  auction,
  onAction,
  canEdit,
  cohost,
  lots,
  selected,
}: {
  auction: Auction;
  onAction: (fn: string, args: Record<string, string>, confirm?: ConfirmOptions) => Promise<void>;
  canEdit: boolean;
  cohost: boolean;
  lots: Lot[];
  selected?: Lot;
}) {
  const args = { p_auction_id: auction.id };
  return (
    <div className="glass enter flex flex-wrap items-center gap-2 rounded-[26px] p-2" style={{ ["--i" as string]: 1 }}>
      <span className="chip bg-brand-100 text-brand-700">{cohost ? "Co-host controls" : "Host controls"}</span>
      {canEdit && (
        <Link to={`/host/a/${auction.id}`} className="btn-ghost py-1.5">
          Edit
        </Link>
      )}
      {auction.status !== "draft" && <HostRoomControls auction={auction} lots={lots} selected={selected} />}
      {(auction.status === "draft" || auction.status === "scheduled") && (
        <button className="btn-accent py-1.5" onClick={() => void onAction("start_auction", args, { title: "Go live now?", body: "Lots open for bidding immediately.", confirmLabel: "Go live" })}>
          Go live
        </button>
      )}
      {auction.status === "live" && (
        <button className="btn-ghost py-1.5" onClick={() => void onAction("pause_auction", args)}>
          Pause
        </button>
      )}
      {auction.status === "paused" && (
        <button className="btn-accent py-1.5" onClick={() => void onAction("resume_auction", args)}>
          Resume
        </button>
      )}
      {(auction.status === "live" || auction.status === "paused") && (
        <button className="btn-danger py-1.5" onClick={() => void onAction("end_auction_now", args, { title: "End the auction now?", body: "Open lots close at their current bid.", confirmLabel: "End auction", cancelLabel: "Keep running", danger: true })}>
          End now
        </button>
      )}
    </div>
  );
}

function LotGrid({
  auction,
  lots,
  media,
  userId,
  isTeam,
  quick,
  selectedId,
  onOpen,
}: {
  auction: Auction;
  lots: Lot[];
  media: Map<string, LotMedia[]>;
  userId: string | null;
  isTeam: boolean;
  quick: QuickBidState;
  selectedId?: string;
  onOpen: (id: string) => void;
}) {
  const names = useProfileNames(lots.map((l) => l.current_winner_id));
  if (lots.length === 0) return <div className="card py-16 text-center text-sm text-stone-500">No lots yet.</div>;
  return (
    <div className="grid animate-rise gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-5">
      {lots.map((l) => {
        const cover = media.get(l.id)?.find((m) => m.kind === "image");
        const mine = userId != null && l.current_winner_id === userId;
        const leader = mine ? t("You") : l.current_winner_id ? names.get(l.current_winner_id) : null;
        const biddable = auction.status === "live" && l.status === "open" && l.sale_type === "english" && userId != null && !isTeam;
        const note = quick.msg?.lotId === l.id ? quick.msg : null;
        return (
          // The whole card opens the lot (a stretched button); the bid button sits above it.
          <div key={l.id} className={`card group relative flex gap-3 p-3 card-hover ${selectedId === l.id ? "ring-2 ring-brand-500" : ""}`}>
            <button type="button" onClick={() => onOpen(l.id)} className="absolute inset-0 rounded-[inherit]" aria-label={t("Open lot #{n}: {title}", { n: l.position + 1, title: l.title })} />
            <div className="pointer-events-none h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-stone-100">
              {cover ? (
                <img src={publicUrl("lot-media", cover.path)} alt="" className="h-full w-full object-cover transition duration-700 ease-[var(--ease-spring)] group-hover:scale-110" loading="lazy" />
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-xs text-stone-500">#{l.position + 1}</div>
              )}
            </div>
            <div className="pointer-events-none min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-semibold">
                <span className="mr-1 text-stone-500">#{l.position + 1}</span>
                {l.title}
              </p>
              <p className="font-display text-lg font-extrabold tabular-nums">{money(l.current_bid ?? l.start_price, auction.settings)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <LotBadge status={l.status} />
                {l.status === "open" && auction.status === "live" && <Countdown endsAt={l.ends_at} />}
                {leader && <span className="truncate">{t(l.status === "sold" ? "Won by {name}" : "Leader: {name}", { name: leader })}</span>}
              </div>
              {biddable && (
                <div className="pointer-events-auto relative mt-2 flex flex-wrap items-center gap-2">
                  {mine ? (
                    <span className="chip bg-emerald-100 text-emerald-800">{t("You're winning")}</span>
                  ) : (
                    <button type="button" className="btn-accent px-3 py-1.5 text-xs" disabled={quick.busyId === l.id} onClick={() => void quick.bid(l)}>
                      {quick.busyId === l.id ? t("Bidding...") : t("Bid {amount}", { amount: money(minNextBid(l, auction.settings), auction.settings) })}
                    </button>
                  )}
                </div>
              )}
              {note && (
                <p role="status" className={`mt-1 text-xs font-medium ${note.ok ? "text-emerald-700" : "text-red-600"}`}>
                  {note.text}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="card mx-auto max-w-md space-y-3 p-8 text-center">
      <p className="font-display text-xl font-bold">{t("Couldn't load this auction")}</p>
      <p className="text-sm text-stone-500">{message}</p>
      <button
        className="btn-primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onRetry().finally(() => setBusy(false));
        }}
      >
        {t(busy ? "Please wait..." : "Try again")}
      </button>
    </div>
  );
}

function RoomSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-stone-100" />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="aspect-[4/3] animate-pulse rounded-2xl bg-stone-100" />
        <div className="h-80 animate-pulse rounded-2xl bg-stone-100" />
      </div>
    </div>
  );
}
