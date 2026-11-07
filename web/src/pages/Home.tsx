import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRightIcon, CalendarBlankIcon, ChatCircleIcon, GavelIcon, LightningIcon, MagnifyingGlassIcon, TimerIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../lib/supabase";
import type { Auction, AuctionSettings, AuctionStatus } from "../lib/types";
import { AuctionBadge } from "../components/StatusBadge";
import { Countdown } from "../components/Countdown";
import { dateTime, money } from "../lib/format";
import { CATEGORIES, categoryLabel } from "../lib/categories";
import { CategoryIcon } from "../components/CategoryIcon";
import { t } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { TIER_STYLE, tierRank, useHostTiers, type Tier } from "../lib/hostTiers";
import { EventBanner, MysteryDrop, RemindButton, TopGuessers, useActiveEvent, useMyReminders } from "../components/HomeExtras";

const tr = t;

type Row = Auction & { lots: { count: number }[] };
type Tab = "live" | "upcoming" | "ended";

const PAGE = 24;
const tabStatuses: Record<Tab, AuctionStatus[]> = {
  live: ["live", "paused"],
  upcoming: ["scheduled"],
  ended: ["ended"],
};

export function Home() {
  const [tab, setTab] = useState<Tab>("live");
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<Tab, number>>({ live: 0, upcoming: 0, ended: 0 });
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventTag, setEventTag] = useState<string | null>(null);
  const activeEvent = useActiveEvent();
  const { session } = useAuth();
  const [reminders, setReminders] = useMyReminders(Boolean(session));

  // Tab counts (cheap HEAD requests).
  useEffect(() => {
    void Promise.all(
      (Object.keys(tabStatuses) as Tab[]).map(async (t) => {
        const { count } = await supabase.from("auctions").select("id", { count: "exact", head: true }).eq("visibility", "public").in("status", tabStatuses[t]);
        return [t, count ?? 0] as const;
      }),
    ).then((pairs) => {
      const next = Object.fromEntries(pairs) as Record<Tab, number>;
      setCounts(next);
      if (next.live === 0 && next.upcoming > 0) setTab("upcoming");
    });
  }, []);

  async function load(reset: boolean) {
    setLoading(true);
    const from = reset ? 0 : rows.length;
    let q = supabase
      .from("auctions")
      .select("*, lots(count)")
      .eq("visibility", "public")
      .in("status", tabStatuses[tab])
      .order(tab === "upcoming" ? "starts_at" : "ends_at", { ascending: tab !== "ended", nullsFirst: false })
      .range(from, from + PAGE - 1);
    if (query.trim()) q = q.ilike("title", `%${query.trim().replace(/[%_]/g, "")}%`);
    if (cat === "league") q = q.eq("mode", "league");
    else if (cat) q = q.eq("category", cat);
    if (eventTag) q = q.contains("tags", [eventTag]);
    const { data, error } = await q;
    if (error) setError(errorMessage(error));
    const page = (data as Row[] | null) ?? [];
    setRows((prev) => (reset ? page : [...prev, ...page]));
    setHasMore(page.length === PAGE);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(() => void load(true), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [tab, query, cat, eventTag]);

  // Better-rated, busier hosts float up among live auctions.
  const tiers = useHostTiers(rows.map((r) => r.host_id));
  const ordered = useMemo(
    () => (tab === "live" ? [...rows].sort((a, b) => tierRank(tiers.get(b.host_id)) - tierRank(tiers.get(a.host_id))) : rows),
    [rows, tiers, tab],
  );
  const featured = useMemo(() => (tab === "live" && !query && !cat && !eventTag ? ordered[0] : undefined), [ordered, tab, query, cat, eventTag]);
  const rest = featured ? ordered.slice(1) : ordered;

  function browse() {
    setTab(counts.live === 0 && counts.upcoming > 0 ? "upcoming" : "live");
    document.getElementById("browse")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-10">
      {/* Hero: follows the page theme; the warm aurora gives the glass board something to refract. */}
      <section className="aurora rounded-[32px] border border-white/70 bg-white/70 px-6 py-10 sm:px-10 sm:py-14 lg:py-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
          <div className="max-w-2xl">
            <span className="glass enter chip px-3 py-1 text-stone-700" style={{ ["--i" as string]: 0 }}>
              {counts.live > 0 && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden="true" />}
              {counts.live > 0 ? t("{n} live now", { n: counts.live }) : counts.upcoming > 0 ? t("{n} starting soon", { n: counts.upcoming }) : t("Real-time auctions")}
            </span>
            <h1
              className="hero-title enter mt-5 font-display text-4xl leading-[1.04] font-extrabold tracking-tight text-stone-900 sm:text-5xl lg:text-6xl"
              style={{ ["--i" as string]: 1 }}
            >
              {t("Bid live. Chat with the room.")} <span className="text-brand-600">{t("Win the lot.")}</span>
            </h1>
            <p className="enter mt-5 max-w-xl text-base leading-relaxed text-stone-600 sm:text-lg" style={{ ["--i" as string]: 2 }}>
              {t("Real-time auctions with auto-bidding, anti-sniping and live streams. Join one, or host your own in minutes.")}
            </p>
            <div className="enter mt-8 flex flex-wrap gap-3" style={{ ["--i" as string]: 3 }}>
              <button className="btn-accent px-6 py-3 text-base" onClick={browse}>
                {t("Browse auctions")}
                <ArrowRightIcon size={18} weight="bold" aria-hidden="true" />
              </button>
              <Link to="/host" className="btn-ghost px-6 py-3 text-base">
                {t("Host an auction")}
              </Link>
            </div>
          </div>
          <div className="enter" style={{ ["--i" as string]: 4 }}>
            <HeroBoard />
          </div>
        </div>
      </section>

      {activeEvent && <EventBanner ev={activeEvent} active={eventTag === activeEvent.tag} onToggle={() => setEventTag((t) => (t ? null : activeEvent.tag))} />}

      <div className="grid gap-5 md:grid-cols-2">
        <MysteryDrop />
        <TopGuessers />
      </div>

      <div id="browse" className="flex scroll-mt-24 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="segmented scrollbar-none overflow-x-auto" role="tablist" aria-label={t("Auction status")}>
          {(["live", "upcoming", "ended"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
              {tr(t === "live" ? "Live now" : t === "upcoming" ? "Upcoming" : "Ended")}
              <span className="ml-1.5 text-xs text-stone-500 tabular-nums">{counts[t]}</span>
            </button>
          ))}
        </div>
        <label className="relative sm:w-72">
          <MagnifyingGlassIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-500" aria-hidden="true" />
          <input
            className="input rounded-full pl-10"
            type="search"
            aria-label={t("Search auctions")}
            placeholder={t("Search auctions")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <div className="scrollbar-none -mx-4 -mt-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {[["", "All"] as const, ["league", "Team leagues"] as const, ...CATEGORIES].map(([k, label]) => (
          <button
            key={k || "all"}
            onClick={() => setCat(k)}
            aria-pressed={cat === k}
            className={`chip min-h-11 shrink-0 border px-4 py-1.5 transition duration-300 sm:min-h-9 ${
              cat === k
                ? "border-stone-900 bg-stone-900 text-white shadow-sm"
                : "border-stone-900/[0.08] bg-white/70 text-stone-700 hover:-translate-y-px hover:bg-white hover:shadow-sm"
            }`}
          >
            <CategoryIcon name={k || "all"} className="h-3.5 w-3.5" /> {t(label)}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {featured && <FeaturedCard a={featured} />}

      {rows.length === 0 && !loading ? (
        <EmptyState tab={tab} counts={counts} onShow={setTab} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-7">
          {rest.map((a, i) => (
            <AuctionCard
              key={a.id}
              a={a}
              i={i}
              tier={tiers.get(a.host_id)}
              remind={session && a.status === "scheduled" ? { on: reminders.has(a.id), set: (on) => setReminders((s) => { const n = new Set(s); if (on) n.add(a.id); else n.delete(a.id); return n; }) } : undefined}
            />
          ))}
          {loading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-[20px] bg-stone-200/60" />)}
        </div>
      )}

      {hasMore && !loading && (
        <div className="text-center">
          <button className="btn-ghost" onClick={() => void load(false)}>
            {t("Load more")}
          </button>
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab, counts, onShow }: { tab: Tab; counts: Record<Tab, number>; onShow: (t: Tab) => void }) {
  const text = t(tab === "live" ? "No auctions are live right now." : tab === "upcoming" ? "Nothing is scheduled yet." : "No finished auctions yet.");
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-brand-700">
        <GavelIcon size={26} weight="bold" aria-hidden="true" />
      </span>
      <p className="font-display text-lg font-extrabold">{text}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {tab !== "upcoming" && counts.upcoming > 0 && (
          <button className="btn-ghost" onClick={() => onShow("upcoming")}>
            {t("See {n} upcoming", { n: counts.upcoming })}
          </button>
        )}
        <Link to="/host" className="btn-accent">
          {t("Host an auction")}
        </Link>
      </div>
    </div>
  );
}

function When({ a }: { a: Row }) {
  if (a.status === "live")
    return (
      <>
        {t("Ends in")} <Countdown endsAt={a.ends_at} className="font-semibold text-stone-900" />
      </>
    );
  if (a.status === "paused") return <>{t("Paused by host")}</>;
  if (a.status === "scheduled") return <>{t("Starts {date}", { date: dateTime(a.starts_at) })}</>;
  return <>{t("Ended {date}", { date: dateTime(a.ends_at) })}</>;
}

function Cover({ a, className }: { a: Pick<Row, "cover_url" | "title">; className: string }) {
  return a.cover_url ? (
    <img src={a.cover_url} alt="" className={`${className} object-cover`} loading="lazy" />
  ) : (
    <div className={`${className} flex items-center justify-center bg-gradient-to-br from-brand-200 via-orange-100 to-rose-200 dark:from-brand-200 dark:via-stone-100 dark:to-rose-200`}>
      <span className="font-display text-5xl font-extrabold text-ink/25 dark:text-snow/25">{a.title.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

function FeaturedCard({ a }: { a: Row }) {
  return (
    <Link
      to={`/a/${a.id}`}
      className="card reveal group grid overflow-hidden transition duration-500 hover:shadow-[0_24px_60px_-24px_rgb(41_37_36/0.35)] md:grid-cols-[1.4fr_1fr]"
    >
      <div className="overflow-hidden">
        <Cover a={a} className="aspect-[16/9] h-full w-full transition duration-700 group-hover:scale-[1.03] md:aspect-auto md:min-h-80" />
      </div>
      <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <AuctionBadge status={a.status} />
          <span className="text-xs font-medium text-stone-500">{t("Featured")} · {t("{n} lots", { n: a.lots[0]?.count ?? 0 })}</span>
        </div>
        <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{a.title}</h2>
        {a.description && <p className="line-clamp-3 text-sm text-stone-600">{a.description}</p>}
        <p className="text-sm text-stone-500">
          <When a={a} />
        </p>
        <span className="btn-accent mt-2 self-start">
          {t("Join the room")}
          <ArrowRightIcon size={16} weight="bold" className="transition duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

function AuctionCard({ a, i, tier, remind }: { a: Row; i: number; tier?: Tier; remind?: { on: boolean; set: (on: boolean) => void } }) {
  // Reveal lives on the wrapper so the hover lift on the card is not overridden by the animation.
  return (
    <div className="reveal relative" style={{ ["--i" as string]: i % 4 }}>
    {remind && <RemindButton auctionId={a.id} on={remind.on} onChange={remind.set} />}
    <Link
      to={`/a/${a.id}`}
      className="card group h-full flex flex-col overflow-hidden transition duration-500 hover:-translate-y-1 hover:shadow-[0_20px_48px_-20px_rgb(41_37_36/0.35)]"
    >
      <div className="overflow-hidden">
        <Cover a={a} className="aspect-[4/3] w-full transition duration-700 group-hover:scale-[1.04]" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <AuctionBadge status={a.status} />
          {a.mode === "league" && <span className="chip bg-stone-900 text-white">{t("League")}</span>}
          {tier && <span className={`chip ${TIER_STYLE[tier].cls}`}>{t(TIER_STYLE[tier].label)}</span>}
          {a.category && (
            <span className="flex items-center gap-1 text-xs text-stone-500">
              <CategoryIcon name={a.category} className="h-3.5 w-3.5" /> {categoryLabel(a.category)}
            </span>
          )}
        </div>
        <h3 className="line-clamp-2 leading-snug font-semibold">{a.title}</h3>
        <p className="mt-auto flex items-center justify-between pt-2 text-xs text-stone-500">
          <span>
            <When a={a} />
          </span>
          <span>{t("{n} lots", { n: a.lots[0]?.count ?? 0 })}</span>
        </p>
      </div>
    </Link>
    </div>
  );
}

type BoardLot = {
  id: string;
  title: string;
  current_bid: number | null;
  start_price: number;
  bid_count: number;
  ends_at: string | null;
  auction_id: string;
  auctions: { settings: AuctionSettings; cover_url: string | null; title: string };
};
type BoardAuction = Pick<Auction, "id" | "title" | "cover_url" | "starts_at">;

/** Hero board on glass: the hottest open lots, or the next auctions to start. Refreshes every 20 seconds. */
function HeroBoard() {
  const [lots, setLots] = useState<BoardLot[] | null>(null);
  const [upcoming, setUpcoming] = useState<BoardAuction[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("lots")
        .select("id, title, current_bid, start_price, bid_count, ends_at, auction_id, auctions!inner(settings, cover_url, title, visibility, status)")
        .eq("status", "open")
        .eq("auctions.visibility", "public")
        .eq("auctions.status", "live")
        .order("bid_count", { ascending: false })
        .limit(4);
      const live = (data as unknown as BoardLot[] | null) ?? [];
      setLots(live);
      if (live.length === 0) {
        const { data: next } = await supabase
          .from("auctions")
          .select("id, title, cover_url, starts_at")
          .eq("visibility", "public")
          .eq("status", "scheduled")
          .order("starts_at", { ascending: true, nullsFirst: false })
          .limit(4);
        setUpcoming((next as BoardAuction[] | null) ?? []);
      }
    };
    void load();
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, []);

  if (lots === null) return <div className="glass h-72 animate-pulse rounded-[28px]" />;

  const title = t(lots.length ? "On the block now" : upcoming.length ? "Starting soon" : "How it works");
  return (
    <div className="glass rounded-[28px] p-2 lg:rotate-[1.5deg] lg:transition lg:duration-700 lg:hover:rotate-0">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-sm font-semibold text-stone-700">{title}</p>
        {lots.length > 0 && <span className="chip bg-red-600 text-snow">{t("Live")}</span>}
      </div>
      <ul>
        {lots.map((l, i) => (
          <li key={l.id} className="enter" style={{ ["--i" as string]: i + 5 }}>
            <Link to={`/a/${l.auction_id}`} className="flex items-center gap-3 rounded-[20px] px-3 py-2.5 transition hover:bg-white/60 dark:hover:bg-snow/5">
              <Cover a={l.auctions} className="h-12 w-12 shrink-0 rounded-2xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-stone-900">{l.title}</span>
                <span className="text-xs text-stone-600">
                  {t(l.bid_count === 1 ? "{n} bid" : "{n} bids", { n: l.bid_count })}
                  {l.ends_at && (
                    <>
                      {" · "}
                      <Countdown endsAt={l.ends_at} />
                    </>
                  )}
                </span>
              </span>
              <span
                key={String(l.current_bid)}
                className="animate-bump rounded-lg px-1 font-display text-lg font-extrabold text-stone-900 tabular-nums"
              >
                {money(l.current_bid ?? l.start_price, l.auctions.settings)}
              </span>
            </Link>
          </li>
        ))}
        {lots.length === 0 &&
          upcoming.map((a, i) => (
            <li key={a.id} className="enter" style={{ ["--i" as string]: i + 5 }}>
              <Link to={`/a/${a.id}`} className="flex items-center gap-3 rounded-[20px] px-3 py-2.5 transition hover:bg-white/60 dark:hover:bg-snow/5">
                <Cover a={a} className="h-12 w-12 shrink-0 rounded-2xl" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-stone-900">{a.title}</span>
                  <span className="flex items-center gap-1 text-xs text-stone-600">
                    <CalendarBlankIcon size={12} weight="bold" aria-hidden="true" /> {dateTime(a.starts_at)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        {lots.length === 0 &&
          upcoming.length === 0 &&
          (
            [
              [LightningIcon, "Auto-bid", "Set a ceiling and AuctionHub bids for you."],
              [TimerIcon, "Anti-snipe", "Late bids extend the clock, so nobody wins by a second."],
              [ChatCircleIcon, "Live room", "Chat, watch the stream and see every bid as it lands."],
            ] as const
          ).map(([Glyph, name, text], i) => (
            <li key={name} className="enter flex items-start gap-3 px-3 py-3" style={{ ["--i" as string]: i + 5 }}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
                <Glyph size={20} weight="bold" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-stone-900">{t(name)}</span>
                <span className="text-sm text-stone-600">{t(text)}</span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
