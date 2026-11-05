import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "react-router";
import { BellRingingIcon, BellSimpleIcon, GiftIcon, SparkleIcon, TargetIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../lib/supabase";
import { useServerNow } from "../lib/clock";
import { money, remaining } from "../lib/format";
import { publicUrl } from "../lib/media";
import { categoryLabel } from "../lib/categories";
import { t } from "../lib/i18n";
import { GuessLeaderboard } from "./live/Predictions";

interface Mystery {
  revealed: boolean;
  reveal_at: string;
  teaser: string;
  category: string | null;
  lot_id?: string;
  auction_id?: string;
  title?: string;
  cover?: string | null;
  price?: number;
  currency?: string;
  status?: string;
}

export interface SiteEvent {
  id: string;
  title: string;
  tag: string;
  description: string;
  color: string;
  starts_at: string;
  ends_at: string;
}

export function useActiveEvent(): SiteEvent | null {
  const [ev, setEv] = useState<SiteEvent | null>(null);
  useEffect(() => {
    const now = new Date().toISOString();
    void supabase
      .from("site_events")
      .select("*")
      .lte("starts_at", now)
      .gte("ends_at", now)
      .order("ends_at")
      .limit(1)
      .then(({ data }) => setEv(((data as SiteEvent[] | null) ?? [])[0] ?? null));
  }, []);
  return ev;
}

/** Weekly themed event banner with a countdown and a filter shortcut. */
export function EventBanner({ ev, active, onToggle }: { ev: SiteEvent; active: boolean; onToggle: () => void }) {
  const now = useServerNow(1000);
  return (
    <section
      className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[28px] p-5 text-snow sm:p-6"
      style={{ background: `linear-gradient(120deg, #0c0a09 30%, ${ev.color})` }}
    >
      <SparkleIcon size={28} weight="fill" className="text-brand-300" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-widest text-brand-300 uppercase">{t("This week")}</p>
        <p className="font-display text-2xl font-extrabold tracking-tight">{ev.title}</p>
        {ev.description && <p className="text-sm text-snow/75">{ev.description}</p>}
      </div>
      <div className="text-right">
        <p className="text-xs text-snow/60">{t("Ends in")}</p>
        <p className="font-mono text-xl font-bold tabular-nums">{remaining(new Date(ev.ends_at).getTime() - now)}</p>
      </div>
      <button className={active ? "btn bg-snow text-ink" : "btn-glass text-snow"} onClick={onToggle}>
        {active ? t("Show everything") : t("Browse event lots")}
      </button>
    </section>
  );
}

/** Today's mystery lot: a silhouette and a countdown, then the reveal. */
export function MysteryDrop() {
  const [m, setM] = useState<Mystery | null | undefined>(undefined);
  const now = useServerNow(1000);
  useEffect(() => {
    void supabase.rpc("mystery_today").then(({ data }) => setM((data as Mystery | null) ?? null));
  }, []);
  // Reload at reveal time.
  useEffect(() => {
    if (m && !m.revealed && new Date(m.reveal_at).getTime() <= now) void supabase.rpc("mystery_today").then(({ data }) => setM(data as Mystery));
  }, [now, m]);
  if (!m) return null;
  const ms = new Date(m.reveal_at).getTime() - now;

  return (
    <div className="card relative overflow-hidden p-5">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-violet-700 uppercase">
        <GiftIcon size={16} weight="fill" aria-hidden="true" /> {t("Daily mystery lot")}
      </p>
      {!m.revealed ? (
        <div className="mt-3 flex items-center gap-4">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500 to-rose-500 font-display text-5xl font-extrabold text-snow blur-[1px]">
            ?
          </div>
          <div className="min-w-0">
            <p className="font-semibold">{m.teaser || (m.category ? t("Something from {cat}", { cat: categoryLabel(m.category) }) : t("Something special"))}</p>
            <p className="mt-1 text-xs text-stone-500">{t("Revealed in")}</p>
            <p className="font-mono text-3xl font-bold text-violet-700 tabular-nums">{remaining(ms)}</p>
          </div>
        </div>
      ) : (
        <Link to={`/a/${m.auction_id}`} className="group mt-3 flex items-center gap-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-3xl bg-stone-100">
            {m.cover && <img src={publicUrl("lot-media", m.cover)} alt="" className="h-full w-full animate-bump object-cover transition duration-700 group-hover:scale-110" />}
          </div>
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-extrabold">{m.title}</p>
            {m.teaser && <p className="text-xs text-stone-500">{m.teaser}</p>}
            <p className="mt-1 font-display text-2xl font-extrabold tabular-nums">{money(m.price ?? 0, { currency: m.currency })}</p>
            <span className="text-sm font-semibold text-brand-700 group-hover:underline">{t("Go to the lot")}</span>
          </div>
        </Link>
      )}
    </div>
  );
}

export function TopGuessers() {
  return (
    <div className="card space-y-3 p-5">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-widest text-amber-700 uppercase">
        <TargetIcon size={16} weight="bold" aria-hidden="true" /> {t("Top guessers this week")}
      </p>
      <GuessLeaderboard days={7} />
      <p className="text-xs text-stone-500">{t("Guess a lot's final price before bidding starts. Closest wins up to 100 points.")}</p>
    </div>
  );
}

/** "Remind me" toggle for an upcoming auction (a notification 10 minutes before it starts). */
export function RemindButton({ auctionId, on, onChange }: { auctionId: string; on: boolean; onChange: (on: boolean) => void }) {
  const [err, setErr] = useState<string | null>(null);
  async function toggle(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const { error } = on
      ? await supabase.from("auction_reminders").delete().eq("auction_id", auctionId)
      : await supabase.from("auction_reminders").insert({ auction_id: auctionId, user_id: (await supabase.auth.getUser()).data.user?.id });
    if (error) setErr(errorMessage(error));
    else onChange(!on);
  }
  return (
    <button
      onClick={(e) => void toggle(e)}
      aria-pressed={on}
      title={err ?? undefined}
      className={`glass-clear chip absolute top-3 right-3 z-10 gap-1.5 px-3 py-1.5 ${on ? "text-brand-700" : "text-stone-800"}`}
    >
      {on ? <BellRingingIcon size={14} weight="fill" aria-hidden="true" /> : <BellSimpleIcon size={14} weight="bold" aria-hidden="true" />}
      {on ? t("Reminder set") : t("Remind me")}
    </button>
  );
}

export function useMyReminders(signedIn: boolean) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!signedIn) return;
    void supabase
      .from("auction_reminders")
      .select("auction_id")
      .then(({ data }) => setIds(new Set(((data as { auction_id: string }[] | null) ?? []).map((r) => r.auction_id))));
  }, [signedIn]);
  return [ids, setIds] as const;
}
