import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useAuth } from "../lib/auth";
import { useAuctionRoom } from "../lib/useAuctionRoom";
import { supabase, errorMessage } from "../lib/supabase";
import { dateTime, money } from "../lib/format";
import { useProfileNames } from "../lib/profiles";
import { publicUrl } from "../lib/media";
import type { Auction, Lot, LotMedia } from "../lib/types";
import { AuctionBadge, LotBadge } from "../components/StatusBadge";
import { BidPanel } from "../components/BidPanel";
import { ChatPanel } from "../components/ChatPanel";
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

type Tab = "lot" | "lots" | "bids" | "results" | "chat";

export function AuctionRoom() {
  const { id } = useParams();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { auction, lots, media, moderatorIds, loading, error, reload } = useAuctionRoom(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((["lot", "lots", "bids", "results", "chat"] as Tab[]).find((t) => t === params.get("tab")) ?? "lot");
  const [hostError, setHostError] = useState<string | null>(null);
  const { isAdmin } = useIsAdmin();

  if (loading) return <RoomSkeleton />;
  if (!auction) return id ? <PrivateGate auctionId={id} onJoined={reload} /> : null;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  const isHost = userId === auction.host_id;
  const isStaff = isHost || isAdmin || (userId != null && moderatorIds.includes(userId));
  const selected: Lot | undefined = lots.find((l) => l.id === selectedId) ?? lots.find((l) => l.status === "open") ?? lots[0];
  const selectedIndex = selected ? lots.indexOf(selected) : -1;
  const finished = auction.status === "ended" || auction.status === "cancelled";

  async function hostAction(fn: string, args: Record<string, string>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setHostError(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) setHostError(errorMessage(error));
  }

  const tabs: { key: Tab; label: string; mobileOnly?: boolean }[] = [
    { key: "lot", label: "Current lot" },
    { key: "lots", label: `All lots (${lots.length})` },
    { key: "bids", label: "Bid log" },
    { key: "results", label: finished ? "Results" : "Standings" },
    { key: "chat", label: "Chat", mobileOnly: true },
  ];

  const openLot = (lotId: string) => {
    setSelectedId(lotId);
    setTab("lot");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AuctionBadge status={auction.status} />
            {auction.mode === "league" && <span className="chip bg-violet-100 text-violet-800">Team league</span>}
            {auction.visibility !== "public" && <span className="chip bg-stone-900 text-white">{visibilityLabel[auction.visibility]}</span>}
            {auction.status === "scheduled" && <span className="text-sm text-stone-500">Starts {dateTime(auction.starts_at)}</span>}
            {auction.status === "live" && auction.mode !== "league" && auction.ends_at && (
              <span className="text-sm text-stone-500">
                Last lot closes in <Countdown endsAt={auction.ends_at} className="font-semibold text-stone-800" />
              </span>
            )}
          </div>
          <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{auction.title}</h1>
          {auction.description && <p className="mt-2 line-clamp-3 max-w-3xl whitespace-pre-line text-sm text-stone-600 sm:text-base">{auction.description}</p>}
        </div>

        {isHost && <HostBar auction={auction} onAction={hostAction} />}
      </div>
      {hostError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{hostError}</p>}

      {auction.mode === "league" ? (
        <LeagueRoom auction={auction} lots={lots} media={media} userId={userId} isHost={isHost} isStaff={isStaff} />
      ) : (
        <>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-5">
            {auction.stream_url && !finished && <StreamEmbed url={auction.stream_url} />}

            {/* Tabs */}
            <div className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="inline-flex gap-1 rounded-xl bg-stone-100 p-1">
                {tabs.map((t) => (
                  <button key={t.key} className={`tab ${tab === t.key ? "tab-active" : ""} ${t.mobileOnly ? "lg:hidden" : ""}`} onClick={() => setTab(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {tab === "lot" &&
              (selected ? (
                <div className="grid animate-rise gap-6 md:grid-cols-2">
                  <div className="min-w-0">
                    <LotGallery items={media.get(selected.id) ?? []} title={selected.title} />
                    <div className="mt-4 flex items-start justify-between gap-3">
                      <h2 className="font-display text-xl font-bold">
                        <span className="mr-2 text-stone-400">#{selected.position + 1}</span>
                        {selected.title}
                      </h2>
                      <div className="flex shrink-0 gap-1">
                        <WatchButton lotId={selected.id} userId={userId} />
                        <button className="btn-ghost px-2.5" disabled={selectedIndex <= 0} onClick={() => setSelectedId(lots[selectedIndex - 1]?.id ?? null)} aria-label="Previous lot">
                          &larr;
                        </button>
                        <button
                          className="btn-ghost px-2.5"
                          disabled={selectedIndex >= lots.length - 1}
                          onClick={() => setSelectedId(lots[selectedIndex + 1]?.id ?? null)}
                          aria-label="Next lot"
                        >
                          &rarr;
                        </button>
                      </div>
                    </div>
                    {selected.description && <p className="mt-2 whitespace-pre-line text-sm text-stone-600">{selected.description}</p>}
                    {Object.keys(selected.custom_fields ?? {}).length > 0 && (
                      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        {Object.entries(selected.custom_fields).map(([k, v]) => (
                          <div key={k} className="rounded-xl bg-stone-100 px-3 py-2">
                            <dt className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">{k}</dt>
                            <dd className="font-medium">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {isHost && selected.status === "open" && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button className="btn-primary" onClick={() => void hostAction("close_lot_now", { p_lot_id: selected.id }, `Close "${selected.title}" now?`)}>
                          Sold! Close lot now
                        </button>
                        <button className="btn-ghost" onClick={() => void hostAction("withdraw_lot", { p_lot_id: selected.id }, `Withdraw "${selected.title}"?`)}>
                          Withdraw
                        </button>
                      </div>
                    )}
                  </div>
                  <div id="bid" className="scroll-mt-20">
                    <BidPanel auction={auction} lot={selected} userId={userId} isHost={isHost} />
                  </div>
                </div>
              ) : (
                <div className="card py-16 text-center text-sm text-stone-500">No lots in this auction yet.</div>
              ))}

            {tab === "lots" && <LotGrid auction={auction} lots={lots} media={media} userId={userId} selectedId={selected?.id} onOpen={openLot} />}
            {tab === "bids" && <BidLog auction={auction} lots={lots} userId={userId} />}
            {tab === "results" && <Results auction={auction} lots={lots} isHost={isHost} userId={userId} />}
            {tab === "chat" && (
              <div className="lg:hidden">
                <ChatPanel auction={auction} userId={userId} isStaff={isStaff} />
              </div>
            )}
          </div>

          <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
            <ChatPanel auction={auction} userId={userId} isStaff={isStaff} />
          </aside>
        </div>

        {/* Mobile sticky bid bar */}
        {selected && tab !== "chat" && selected.status === "open" && auction.status === "live" && (
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            <div className="mx-auto flex max-w-xl items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-stone-500">
                  #{selected.position + 1} {selected.title}
                </p>
                <p className="flex items-baseline gap-2">
                  <span className="text-lg font-bold tabular-nums">{money(selected.current_bid ?? selected.start_price, auction.settings)}</span>
                  <Countdown endsAt={selected.ends_at} className="text-sm" />
                </p>
              </div>
              {userId && selected.current_winner_id === userId ? (
                <span className="chip bg-emerald-100 text-emerald-800">Winning</span>
              ) : (
                !isHost && (
                  <button
                    className="btn-accent px-6 py-3"
                    onClick={() => {
                      setTab("lot");
                      setTimeout(() => document.getElementById("bid")?.scrollIntoView({ behavior: "smooth" }), 50);
                    }}
                  >
                    Bid
                  </button>
                )
              )}
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
}

function HostBar({ auction, onAction }: { auction: Auction; onAction: (fn: string, args: Record<string, string>, confirm?: string) => Promise<void> }) {
  const args = { p_auction_id: auction.id };
  return (
    <div className="card flex flex-wrap items-center gap-2 p-2.5">
      <span className="chip bg-brand-100 text-brand-700">Host controls</span>
      <Link to={`/host/a/${auction.id}`} className="btn-ghost py-1.5">
        Edit
      </Link>
      {(auction.status === "draft" || auction.status === "scheduled") && (
        <button className="btn-accent py-1.5" onClick={() => void onAction("start_auction", args, "Start the auction now?")}>
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
        <button className="btn-danger py-1.5" onClick={() => void onAction("end_auction_now", args, "End the auction now? Open lots close at their current bid.")}>
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
  selectedId,
  onOpen,
}: {
  auction: Auction;
  lots: Lot[];
  media: Map<string, LotMedia[]>;
  userId: string | null;
  selectedId?: string;
  onOpen: (id: string) => void;
}) {
  const names = useProfileNames(lots.map((l) => l.current_winner_id));
  if (lots.length === 0) return <div className="card py-16 text-center text-sm text-stone-500">No lots yet.</div>;
  return (
    <div className="grid animate-rise gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {lots.map((l) => {
        const cover = media.get(l.id)?.find((m) => m.kind === "image");
        const leader = userId && l.current_winner_id === userId ? "You" : l.current_winner_id ? names.get(l.current_winner_id) : null;
        return (
          <button
            key={l.id}
            onClick={() => onOpen(l.id)}
            className={`card group flex gap-3 p-3 text-left transition hover:shadow-md ${selectedId === l.id ? "ring-2 ring-stone-900" : ""}`}
          >
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-stone-100">
              {cover ? (
                <img src={publicUrl("lot-media", cover.path)} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-xs text-stone-400">#{l.position + 1}</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm font-semibold">
                <span className="mr-1 text-stone-400">#{l.position + 1}</span>
                {l.title}
              </p>
              <p className="font-bold tabular-nums">{money(l.current_bid ?? l.start_price, auction.settings)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                <LotBadge status={l.status} />
                {l.status === "open" && auction.status === "live" && <Countdown endsAt={l.ends_at} />}
                {leader && <span className="truncate">{l.status === "sold" ? `Won by ${leader}` : `Leader: ${leader}`}</span>}
              </div>
            </div>
          </button>
        );
      })}
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
