import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { EnvelopeSimpleIcon, HandCoinsIcon, TrendDownIcon } from "@phosphor-icons/react";
import { supabase, errorMessage, channelName } from "../lib/supabase";
import { money } from "../lib/format";
import { useServerNow } from "../lib/clock";
import { useProfileNames } from "../lib/profiles";
import { dutchPrice, dutchSettings, nextDropIn } from "../lib/saleTypes";
import { confirmDialog } from "../lib/confirm";
import type { Auction, Lot } from "../lib/types";
import { Countdown } from "./Countdown";
import { LotBadge } from "./StatusBadge";

interface Props {
  auction: Auction;
  lot: Lot;
  userId: string | null;
  isHost: boolean;
}

type Feedback = { ok: boolean; text: string } | null;

/** Bid panel for Dutch, sealed-bid and make-an-offer lots. */
export function SaleTypePanel(props: Props) {
  const { auction, lot, userId } = props;
  const open = lot.status === "open" && auction.status === "live";
  const names = useProfileNames([lot.current_winner_id]);
  const Icon = lot.sale_type === "dutch" ? TrendDownIcon : lot.sale_type === "sealed" ? EnvelopeSimpleIcon : HandCoinsIcon;
  const label = lot.sale_type === "dutch" ? "Dutch auction" : lot.sale_type === "sealed" ? "Sealed bid" : "Make an offer";

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="chip bg-brand-100 text-brand-700">
          <Icon size={14} weight="bold" aria-hidden="true" /> {label}
        </span>
        <div className="text-right">
          <LotBadge status={lot.status} />
          {lot.status === "open" && (
            <p className="mt-1 text-sm text-stone-500">
              Closes in <Countdown endsAt={auction.status === "paused" ? null : lot.ends_at} className="font-semibold text-stone-900" />
            </p>
          )}
        </div>
      </div>

      {lot.status === "sold" && (
        <div>
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Sold for</p>
          <p className="font-display text-4xl font-extrabold tabular-nums">{money(lot.current_bid, auction.settings)}</p>
          <p className="mt-1 text-sm text-stone-500">
            to {lot.current_winner_id === userId ? "you" : (names.get(lot.current_winner_id ?? "") ?? "...")}
            {lot.sale_type === "sealed" && " · all sealed bids are now in the bid log"}
          </p>
        </div>
      )}
      {lot.status === "unsold" && <p className="text-sm text-stone-500">Closed without a sale.</p>}

      {open && !userId && (
        <Link to={`/login?next=/a/${auction.id}`} className="btn-primary w-full">
          Sign in to take part
        </Link>
      )}
      {lot.sale_type === "dutch" && <DutchBody {...props} open={open} />}
      {lot.sale_type === "sealed" && <SealedBody {...props} open={open} />}
      {lot.sale_type === "offer" && <OfferBody {...props} open={open} />}
    </div>
  );
}

function Status({ feedback }: { feedback: Feedback }) {
  return (
    <div role="status" aria-live="polite">
      {feedback && <p className={`text-sm font-medium ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.text}</p>}
    </div>
  );
}

function DutchBody({ auction, lot, userId, isHost, open }: Props & { open: boolean }) {
  const now = useServerNow(500);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  if (lot.status !== "open") return null;
  const s = dutchSettings(lot);
  const price = dutchPrice(lot, now, auction.status === "paused" ? auction.paused_at : null);
  const drop = nextDropIn(lot, now);

  async function accept() {
    const ok = await confirmDialog({
      title: `Buy "${lot.title}"?`,
      body: "The price can drop again in a moment, but someone else may accept first. This can't be undone.",
      confirmLabel: `Buy at ${money(price, auction.settings)}`,
    });
    if (!ok) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("dutch_accept", { p_lot_id: lot.id });
    setBusy(false);
    setFeedback(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: `You bought it for ${money((data as { current_bid: number }).current_bid, auction.settings)}` });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Price now</p>
        <p key={price} className="-mx-1 inline-block animate-bump rounded-lg px-1 font-display text-4xl font-extrabold tabular-nums">
          {money(price, auction.settings)}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          Drops {money(s.step, auction.settings)} every {s.interval_s}s, down to {money(s.floor, auction.settings)}
          {drop > 0 && auction.status === "live" && <> · next drop in {Math.ceil(drop / 1000)}s</>}
        </p>
      </div>
      {open && userId && !isHost && (
        <button className="btn-accent w-full py-3 text-base" disabled={busy} onClick={() => void accept()}>
          {busy ? "Buying..." : `Buy at ${money(price, auction.settings)}`}
        </button>
      )}
      {isHost && <p className="text-sm text-stone-500">You're the host. Hosts can't buy.</p>}
      <Status feedback={feedback} />
    </div>
  );
}

function SealedBody({ auction, lot, userId, isHost, open }: Props & { open: boolean }) {
  const [mine, setMine] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!userId) return;
    void supabase
      .from("sealed_bids")
      .select("amount")
      .eq("lot_id", lot.id)
      .eq("bidder_id", userId)
      .maybeSingle()
      .then(({ data }) => setMine(data ? Number(data.amount) : null));
  }, [lot.id, lot.bid_count, userId]);

  if (lot.status !== "open") return null;
  const min = mine != null ? mine + 0.01 : Number(lot.start_price);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!(value >= min)) return setFeedback({ ok: false, text: `Enter at least ${money(min, auction.settings)}` });
    setBusy(true);
    const { error } = await supabase.rpc("place_sealed_bid", { p_lot_id: lot.id, p_amount: value });
    setBusy(false);
    if (error) return setFeedback({ ok: false, text: errorMessage(error) });
    setMine(value);
    setAmount("");
    setFeedback({ ok: true, text: `Sealed bid of ${money(value, auction.settings)} placed. Nobody can see it until the lot closes.` });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Bids are hidden</p>
        <p className="font-display text-4xl font-extrabold tabular-nums">
          {lot.bid_count} bidder{lot.bid_count === 1 ? "" : "s"}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          Minimum {money(lot.start_price, auction.settings)}. Highest bid wins when the lot closes; the earlier bid wins a tie. You can raise your bid, not lower it.
        </p>
      </div>
      {mine != null && (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">Your sealed bid: {money(mine, auction.settings)}</p>
      )}
      {open && userId && !isHost && (
        <form onSubmit={submit} className="flex gap-2">
          <label className="sr-only" htmlFor="sealed-amt">
            Sealed bid amount
          </label>
          <input
            id="sealed-amt"
            className="input"
            type="number"
            step="0.01"
            min={min}
            placeholder={String(min)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button className="btn-accent shrink-0" disabled={busy}>
            {mine != null ? "Raise bid" : "Place sealed bid"}
          </button>
        </form>
      )}
      {isHost && <p className="text-sm text-stone-500">Bids are hidden from you too until the lot closes.</p>}
      <Status feedback={feedback} />
    </div>
  );
}

interface Offer {
  id: string;
  bidder_id: string;
  amount: number;
  message: string;
  status: "pending" | "accepted" | "declined" | "withdrawn" | "expired";
  created_at: string;
}

const offerTone: Record<Offer["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  accepted: "bg-emerald-100 text-emerald-800",
  declined: "bg-red-100 text-red-700",
  withdrawn: "bg-stone-100 text-stone-600",
  expired: "bg-stone-100 text-stone-600",
};

function OfferBody({ auction, lot, userId, isHost, open }: Props & { open: boolean }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const names = useProfileNames(offers.map((o) => o.bidder_id));

  useEffect(() => {
    if (!userId) return;
    const load = () =>
      void supabase
        .from("lot_offers")
        .select("id, bidder_id, amount, message, status, created_at")
        .eq("lot_id", lot.id)
        .order("created_at", { ascending: false })
        .limit(50)
        .then(({ data }) => setOffers((data as Offer[] | null) ?? []));
    load();
    const ch = supabase
      .channel(channelName(`offers:${lot.id}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "lot_offers", filter: `lot_id=eq.${lot.id}` }, load)
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [lot.id, lot.status, userId]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!(value >= Number(lot.start_price) && value > 0)) return setFeedback({ ok: false, text: `Minimum offer is ${money(lot.start_price, auction.settings)}` });
    setBusy(true);
    const { error } = await supabase.rpc("make_offer", { p_lot_id: lot.id, p_amount: value, p_message: message.trim() });
    setBusy(false);
    if (error) return setFeedback({ ok: false, text: errorMessage(error) });
    setAmount("");
    setMessage("");
    setFeedback({ ok: true, text: "Offer sent. The host will accept or decline it." });
  }

  async function respond(o: Offer, accept: boolean) {
    if (accept) {
      const ok = await confirmDialog({
        title: `Accept ${money(o.amount, auction.settings)}?`,
        body: `The lot sells to ${names.get(o.bidder_id) ?? "this bidder"} and every other offer is declined.`,
        confirmLabel: "Accept offer",
      });
      if (!ok) return;
    }
    const { error } = await supabase.rpc("respond_offer", { p_offer_id: o.id, p_accept: accept });
    setFeedback(error ? { ok: false, text: errorMessage(error) } : null);
  }

  async function withdraw(o: Offer) {
    const { error } = await supabase.rpc("withdraw_offer", { p_offer_id: o.id });
    setFeedback(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: "Offer withdrawn." });
  }

  async function buyNow() {
    if (!lot.buy_now_price) return;
    const ok = await confirmDialog({
      title: `Buy "${lot.title}" now?`,
      body: "You become the winner straight away. This can't be undone.",
      confirmLabel: `Buy for ${money(lot.buy_now_price, auction.settings)}`,
    });
    if (!ok) return;
    const { error } = await supabase.rpc("buy_now", { p_lot_id: lot.id });
    setFeedback(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: "You bought this lot!" });
  }

  const pending = offers.filter((o) => o.status === "pending").sort((a, b) => b.amount - a.amount);
  const shown = isHost ? [...pending, ...offers.filter((o) => o.status !== "pending")] : offers;

  return (
    <div className="space-y-3">
      {lot.status === "open" && (
        <div>
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{lot.buy_now_price ? "Asking price" : "Offers from"}</p>
          <p className="font-display text-4xl font-extrabold tabular-nums">{money(lot.buy_now_price ?? lot.start_price, auction.settings)}</p>
          <p className="mt-1 text-sm text-stone-500">
            {lot.bid_count} offer{lot.bid_count === 1 ? "" : "s"} so far · minimum offer {money(lot.start_price, auction.settings)}
          </p>
        </div>
      )}

      {open && userId && !isHost && (
        <form onSubmit={send} className="space-y-2">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="offer-amt">
              Offer amount
            </label>
            <input id="offer-amt" className="input" type="number" step="0.01" min={lot.start_price} placeholder="Your offer" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button className="btn-accent shrink-0" disabled={busy}>
              Send offer
            </button>
          </div>
          <label className="sr-only" htmlFor="offer-msg">
            Message to the host
          </label>
          <input id="offer-msg" className="input" maxLength={200} placeholder="Message to the host (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
          {lot.buy_now_price && (
            <button type="button" className="btn-primary w-full" onClick={() => void buyNow()}>
              Buy now for {money(lot.buy_now_price, auction.settings)}
            </button>
          )}
        </form>
      )}

      <Status feedback={feedback} />

      {userId && shown.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">{isHost ? "Offers" : "Your offers"}</h3>
          <ul className="max-h-72 divide-y divide-stone-100 overflow-y-auto text-sm">
            {shown.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold tabular-nums">{money(o.amount, auction.settings)}</span>
                  {isHost && <span className="text-stone-500"> · {names.get(o.bidder_id) ?? "Bidder"}</span>}
                  {o.message && <span className="block truncate text-xs text-stone-500">"{o.message}"</span>}
                </span>
                <span className={`chip ${offerTone[o.status]}`}>{o.status}</span>
                {isHost && o.status === "pending" && open && (
                  <>
                    <button className="btn-accent px-3 py-1" onClick={() => void respond(o, true)}>
                      Accept
                    </button>
                    <button className="btn-ghost px-3 py-1" onClick={() => void respond(o, false)}>
                      Decline
                    </button>
                  </>
                )}
                {!isHost && o.status === "pending" && (
                  <button className="btn-ghost px-3 py-1" onClick={() => void withdraw(o)}>
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
