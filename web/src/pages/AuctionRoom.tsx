import { useState } from "react";
import { Link, useParams } from "react-router";
import { useAuth } from "../lib/auth";
import { useAuctionRoom } from "../lib/useAuctionRoom";
import { supabase, errorMessage } from "../lib/supabase";
import { dateTime, money } from "../lib/format";
import { AuctionBadge, LotBadge } from "../components/StatusBadge";
import { BidPanel } from "../components/BidPanel";
import { ChatPanel } from "../components/ChatPanel";
import { LotGallery } from "../components/LotGallery";
import { StreamEmbed } from "../components/StreamEmbed";
import { Countdown } from "../components/Countdown";
import { publicUrl } from "../lib/media";
import type { Lot } from "../lib/types";

export function AuctionRoom() {
  const { id } = useParams();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { auction, lots, media, moderatorIds, loading, error } = useAuctionRoom(id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);

  if (loading) return <p className="text-sm text-stone-500">Loading auction...</p>;
  if (error || !auction) return <p className="text-sm text-red-600">{error ?? "Auction not found"}</p>;

  const isHost = userId === auction.host_id;
  const isStaff = isHost || (userId != null && moderatorIds.includes(userId));
  const selected: Lot | undefined =
    lots.find((l) => l.id === selectedId) ?? lots.find((l) => l.status === "open") ?? lots[0];

  async function hostAction(fn: string, args: Record<string, string>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setHostError(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) setHostError(errorMessage(error));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <AuctionBadge status={auction.status} />
            {auction.status === "scheduled" && <span className="text-sm text-stone-500">Starts {dateTime(auction.starts_at)}</span>}
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{auction.title}</h1>
          {auction.description && <p className="mt-2 max-w-3xl whitespace-pre-line text-stone-600">{auction.description}</p>}
        </div>

        {isHost && (
          <div className="card flex flex-wrap items-center gap-2 p-3">
            <span className="mr-1 text-xs font-semibold text-stone-500 uppercase">Host</span>
            <Link to={`/host/a/${auction.id}`} className="btn-ghost">
              Edit
            </Link>
            {(auction.status === "draft" || auction.status === "scheduled") && (
              <button className="btn-accent" onClick={() => void hostAction("start_auction", { p_auction_id: auction.id }, "Start the auction now?")}>
                Go live
              </button>
            )}
            {auction.status === "live" && (
              <button className="btn-ghost" onClick={() => void hostAction("pause_auction", { p_auction_id: auction.id })}>
                Pause
              </button>
            )}
            {auction.status === "paused" && (
              <button className="btn-accent" onClick={() => void hostAction("resume_auction", { p_auction_id: auction.id })}>
                Resume
              </button>
            )}
            {(auction.status === "live" || auction.status === "paused") && (
              <button
                className="btn-danger"
                onClick={() =>
                  void hostAction("end_auction_now", { p_auction_id: auction.id }, "End the auction now? Open lots close at their current bid.")
                }
              >
                End now
              </button>
            )}
          </div>
        )}
      </div>
      {hostError && <p className="text-sm text-red-600">{hostError}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {auction.stream_url && <StreamEmbed url={auction.stream_url} />}

          {selected ? (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <LotGallery items={media.get(selected.id) ?? []} title={selected.title} />
                <h2 className="mt-4 text-xl font-bold">
                  <span className="mr-2 text-stone-400">#{selected.position + 1}</span>
                  {selected.title}
                </h2>
                {selected.description && <p className="mt-2 whitespace-pre-line text-sm text-stone-600">{selected.description}</p>}
                {Object.keys(selected.custom_fields ?? {}).length > 0 && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {Object.entries(selected.custom_fields).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-stone-500">{k}</dt>
                        <dd className="font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {isHost && selected.status === "open" && (
                  <div className="mt-4 flex gap-2">
                    <button
                      className="btn-primary"
                      onClick={() => void hostAction("close_lot_now", { p_lot_id: selected.id }, `Close "${selected.title}" now?`)}
                    >
                      Close lot now
                    </button>
                    <button
                      className="btn-ghost"
                      onClick={() => void hostAction("withdraw_lot", { p_lot_id: selected.id }, `Withdraw "${selected.title}"?`)}
                    >
                      Withdraw
                    </button>
                  </div>
                )}
              </div>
              <BidPanel auction={auction} lot={selected} userId={userId} isHost={isHost} />
            </div>
          ) : (
            <p className="text-sm text-stone-500">No lots in this auction yet.</p>
          )}

          <section>
            <h2 className="mb-3 text-lg font-bold">All lots ({lots.length})</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {lots.map((l) => {
                const cover = media.get(l.id)?.find((m) => m.kind === "image");
                return (
                  <button
                    key={l.id}
                    onClick={() => setSelectedId(l.id)}
                    className={`card flex gap-3 p-3 text-left transition hover:shadow ${selected?.id === l.id ? "ring-2 ring-stone-900" : ""}`}
                  >
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                      {cover && <img src={publicUrl("lot-media", cover.path)} alt="" className="h-full w-full object-cover" loading="lazy" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-sm font-semibold">{l.title}</p>
                      <p className="text-sm tabular-nums">{money(l.current_bid ?? l.start_price, auction.settings)}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
                        <LotBadge status={l.status} />
                        {l.status === "open" && auction.status === "live" && <Countdown endsAt={l.ends_at} />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <ChatPanel auction={auction} userId={userId} isStaff={isStaff} />
        </aside>
      </div>
    </div>
  );
}
