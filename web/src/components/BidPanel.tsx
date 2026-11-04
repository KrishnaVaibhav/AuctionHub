import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase, errorMessage } from "../lib/supabase";
import { bidIncrement, minNextBid, round2 } from "../lib/bidding";
import { money } from "../lib/format";
import { useProfileNames } from "../lib/profiles";
import type { Auction, Bid, BidResult, Lot } from "../lib/types";
import { Countdown } from "./Countdown";
import { LotBadge } from "./StatusBadge";
import { confirmDialog } from "../lib/confirm";
import { SaleTypePanel } from "./SaleTypePanel";
import { t } from "../lib/i18n";

interface Props {
  auction: Auction;
  lot: Lot;
  userId: string | null;
  isHost: boolean;
}

export function BidPanel({ auction, lot, userId, isHost }: Props) {
  const settings = auction.settings;
  const minBid = minNextBid(lot, settings);
  const [amount, setAmount] = useState(String(minBid));
  const [maxAmount, setMaxAmount] = useState("");
  const [myMax, setMyMax] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const names = useProfileNames([lot.current_winner_id, ...bids.map((b) => b.bidder_id)]);

  const canBid = auction.status === "live" && lot.status === "open" && !isHost;
  const leading = userId != null && lot.current_winner_id === userId;

  // Keep the suggested amount at least the minimum as the price moves.
  useEffect(() => {
    setAmount((prev) => (Number(prev) < minBid ? String(minBid) : prev));
  }, [minBid]);

  // Screen-reader announcements for price and status changes made by other people.
  const [announce, setAnnounce] = useState<{ text: string; urgent: boolean }>({ text: "", urgent: false });
  const prev = useRef({ lot: lot.id, bid: lot.current_bid, winner: lot.current_winner_id, status: lot.status });
  useEffect(() => {
    const p = prev.current;
    prev.current = { lot: lot.id, bid: lot.current_bid, winner: lot.current_winner_id, status: lot.status };
    if (p.lot !== lot.id) return;
    const price = money(lot.current_bid ?? lot.start_price, settings);
    if (p.status === "open" && lot.status !== "open") {
      const won = userId != null && lot.current_winner_id === userId;
      setAnnounce({ text: lot.status === "sold" ? (won ? t("You won this lot for {amount}", { amount: price }) : t("Sold for {amount}", { amount: price })) : t("Lot closed: {status}", { status: t(lot.status) }), urgent: won });
    } else if (p.bid !== lot.current_bid) {
      if (userId && p.winner === userId && lot.current_winner_id !== userId) setAnnounce({ text: t("You've been outbid. Current bid {amount}", { amount: price }), urgent: true });
      // My own bids are announced by the form feedback below.
      else if (userId && lot.current_winner_id === userId) return;
      else setAnnounce({ text: t("New bid: {amount}", { amount: price }), urgent: false });
    }
  }, [lot.id, lot.current_bid, lot.current_winner_id, lot.status, lot.start_price, settings, userId]);

  // Reset the form when switching lots.
  const [shownLot, setShownLot] = useState(lot.id);
  if (shownLot !== lot.id) {
    setShownLot(lot.id);
    setAmount(String(minBid));
    setMaxAmount("");
    setFeedback(null);
  }

  // Refresh bid history + my proxy ceiling whenever the lot's bid count changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("bids").select("*").eq("lot_id", lot.id).order("id", { ascending: false }).limit(15);
      if (!cancelled) setBids((data as Bid[] | null) ?? []);
      if (userId) {
        const { data: pb } = await supabase
          .from("proxy_bids")
          .select("max_amount")
          .eq("lot_id", lot.id)
          .eq("bidder_id", userId)
          .maybeSingle();
        if (!cancelled) setMyMax(pb ? Number(pb.max_amount) : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lot.id, lot.bid_count, userId]);

  async function placeBid(e?: FormEvent, override?: number) {
    e?.preventDefault();
    const value = round2(override ?? Number(amount));
    const max = maxAmount ? round2(Number(maxAmount)) : null;
    if (!leading && (!Number.isFinite(value) || value < minBid)) {
      setFeedback({ ok: false, text: t("Minimum bid is {amount}", { amount: money(minBid, settings) }) });
      return;
    }
    if (max != null && max < value) {
      setFeedback({ ok: false, text: t("Auto-bid maximum must be at least your bid") });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const { data, error } = await supabase.rpc("place_bid", {
      p_lot_id: lot.id,
      p_amount: leading ? Number(lot.current_bid) : value,
      p_max_amount: max,
    });
    setBusy(false);
    if (error) {
      setFeedback({ ok: false, text: errorMessage(error) });
      return;
    }
    const res = data as BidResult;
    setMaxAmount("");
    if (res.status === "leading") setFeedback({ ok: true, text: t("You're the highest bidder at {amount}", { amount: money(res.current_bid, settings) }) });
    else if (res.status === "max_raised") setFeedback({ ok: true, text: t("Auto-bid maximum raised to {amount}", { amount: money(res.max_amount, settings) }) });
    else setFeedback({ ok: false, text: t("Outbid by an auto-bid. Current price {amount}", { amount: money(res.current_bid, settings) }) });
  }

  async function buyNow() {
    if (!lot.buy_now_price) return;
    const ok = await confirmDialog({
      title: `Buy "${lot.title}" now?`,
      body: "Bidding on this lot closes and you become the winner. This can't be undone.",
      confirmLabel: `Buy for ${money(lot.buy_now_price, settings)}`,
    });
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.rpc("buy_now", { p_lot_id: lot.id });
    setBusy(false);
    setFeedback(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: t("You bought this lot!") });
  }

  const step = bidIncrement(Number(lot.current_bid ?? lot.start_price), settings);
  const quick = [minBid, round2(minBid + step), round2(minBid + step * 4)];

  if (lot.sale_type && lot.sale_type !== "english") return <SaleTypePanel auction={auction} lot={lot} userId={userId} isHost={isHost} />;

  return (
    <div className="card space-y-4 p-5">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce.urgent ? "" : announce.text}
      </p>
      <p className="sr-only" aria-live="assertive" aria-atomic="true">
        {announce.urgent ? announce.text : ""}
      </p>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            {t(lot.current_bid == null ? "Starting price" : "Current bid")}
          </p>
          <p key={String(lot.current_bid)} className="-mx-1 inline-block origin-left animate-bump rounded-lg px-1 font-display text-4xl font-extrabold tabular-nums">
            {money(lot.current_bid ?? lot.start_price, settings)}
          </p>
          <p className="mt-1 text-sm text-stone-500">
            {t(lot.bid_count === 1 ? "{n} bid" : "{n} bids", { n: lot.bid_count })}
            {lot.current_winner_id && <> · {t("leader")} {leading ? t("you") : (names.get(lot.current_winner_id) ?? "...")}</>}
            {!lot.reserve_met && <span className="ml-2 font-medium text-amber-700">{t("Reserve not met")}</span>}
          </p>
        </div>
        <div className="text-right">
          <LotBadge status={lot.status} />
          {lot.status === "open" && (
            <p className="mt-2 text-2xl font-semibold">
              <Countdown endsAt={auction.status === "paused" ? null : lot.ends_at} />
              {auction.status === "paused" && <span className="text-base text-amber-700">{t("Paused")}</span>}
            </p>
          )}
        </div>
      </div>

      {leading && lot.status === "open" && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
          {t("You're winning")}
          {myMax ? ` · ${t("auto-bid up to {amount}", { amount: money(myMax, settings) })}` : ""}
        </p>
      )}

      {!userId && lot.status === "open" && (
        <Link to={`/login?next=/a/${auction.id}`} className="btn-primary w-full">
          {t("Sign in to bid")}
        </Link>
      )}

      {userId && canBid && (
        <form onSubmit={placeBid} className="space-y-3">
          {!leading && (
            <div className="grid grid-cols-3 gap-2">
              {quick.map((q) => (
                <button key={q} type="button" className="btn-ghost px-2" disabled={busy} onClick={() => void placeBid(undefined, q)}>
                  {money(q, settings)}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {!leading && (
              <div>
                <label className="label" htmlFor="amt">
                  {t("Your bid")}
                </label>
                <input id="amt" className="input" type="number" min={minBid} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
            )}
            <div className={leading ? "col-span-2" : ""}>
              <label className="label" htmlFor="max">
                {t(leading ? "Raise auto-bid max" : "Auto-bid max (optional)")}
              </label>
              <input
                id="max"
                className="input"
                type="number"
                step="0.01"
                placeholder={t("e.g. 5000")}
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                required={leading}
              />
            </div>
          </div>
          <button className="btn-accent w-full py-3 text-base" disabled={busy}>
            {busy ? t("Placing...") : leading ? t("Update auto-bid") : t("Bid {amount}", { amount: money(Number(amount) || minBid, settings) })}
          </button>
          {lot.buy_now_price && lot.bid_count === 0 && (
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void buyNow()}>
              {t("Buy now for {amount}", { amount: money(lot.buy_now_price, settings) })}
            </button>
          )}
        </form>
      )}

      {isHost && lot.status === "open" && <p className="text-sm text-stone-500">{t("You're the host. Hosts can't bid.")}</p>}

      <div role="status" aria-live="polite">
        {feedback && <p className={`text-sm font-medium ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.text}</p>}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">{t("Bid history")}</h3>
        {bids.length === 0 ? (
          <p className="text-sm text-stone-500">{t("No bids yet.")}</p>
        ) : (
          <ul className="max-h-56 divide-y divide-stone-100 overflow-y-auto text-sm">
            {bids.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-1.5">
                <span>
                  {b.bidder_id === userId ? t("You") : (names.get(b.bidder_id) ?? t("Bidder"))}
                  {b.is_auto && <span className="ml-1.5 rounded bg-stone-100 px-1 text-xs text-stone-600">AUTO</span>}
                </span>
                <span className="font-medium tabular-nums">{money(b.amount, settings)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
