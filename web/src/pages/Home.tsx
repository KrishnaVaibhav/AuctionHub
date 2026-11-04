import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { supabase, errorMessage } from "../lib/supabase";
import type { Auction, AuctionSettings, AuctionStatus } from "../lib/types";
import { AuctionBadge } from "../components/StatusBadge";
import { Countdown } from "../components/Countdown";
import { dateTime, money } from "../lib/format";
import { CATEGORIES, categoryLabel } from "../lib/categories";
import { CategoryIcon } from "../components/CategoryIcon";

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
  }, [tab, query, cat]);

  const featured = useMemo(() => (tab === "live" && !query && !cat ? rows[0] : undefined), [rows, tab, query, cat]);
  const rest = featured ? rows.slice(1) : rows;

  return (
    <div className="space-y-8">
      <section className="grid gap-8 overflow-hidden rounded-3xl bg-ink px-6 py-10 text-snow ring-1 ring-transparent sm:px-10 sm:py-14 lg:grid-cols-[1.3fr_1fr] lg:items-center dark:ring-snow/10">
        <div className="max-w-2xl">
          <span className="chip bg-snow/10 text-brand-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            {counts.live} live now
          </span>
          <h1 className="mt-4 font-display text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-5xl">
            Bid live. Chat with the room. <span className="text-brand-400">Win the lot.</span>
          </h1>
          <p className="mt-4 max-w-xl text-snow/70">
            Real-time auctions with auto-bidding, anti-sniping and live streams. Join one, or host your own in minutes.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <button
              className="btn-accent px-5 py-3"
              onClick={() => {
                setTab(counts.live === 0 && counts.upcoming > 0 ? "upcoming" : "live");
                document.getElementById("browse")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Browse live auctions
            </button>
            <Link to="/host" className="btn border border-snow/20 px-5 py-3 text-snow hover:bg-snow/10">
              Host an auction
            </Link>
          </div>
        </div>
        <LiveBoard />
      </section>

      <div id="browse" className="flex scroll-mt-24 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="scrollbar-none flex gap-1 overflow-x-auto rounded-xl bg-stone-100 p-1">
          {(["live", "upcoming", "ended"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "tab-active" : ""}`} onClick={() => setTab(t)}>
              {t === "live" ? "Live now" : t === "upcoming" ? "Upcoming" : "Ended"}
              <span className="ml-1.5 text-xs text-stone-500">{counts[t]}</span>
            </button>
          ))}
        </div>
        <input
          className="input sm:max-w-xs"
          type="search"
          aria-label="Search auctions"
          placeholder="Search auctions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {[["", "All"] as const, ["league", "Team leagues"] as const, ...CATEGORIES].map(([k, label]) => (
          <button
            key={k || "all"}
            onClick={() => setCat(k)}
            aria-pressed={cat === k}
            className={`chip min-h-11 shrink-0 border px-3.5 py-1.5 sm:min-h-8 ${cat === k ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"}`}
          >
            <CategoryIcon name={k || "all"} className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {featured && <FeaturedCard a={featured} />}

      {rows.length === 0 && !loading ? (
        <div className="card py-16 text-center">
          <p className="font-semibold">Nothing here yet</p>
          <p className="mt-1 text-sm text-stone-500">
            {tab === "live" ? "No auctions are live right now." : tab === "upcoming" ? "Nothing is scheduled." : "No finished auctions."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rest.map((a) => (
            <AuctionCard key={a.id} a={a} />
          ))}
          {loading && Array.from({ length: 4 }).map((_, i) => <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-stone-100" />)}
        </div>
      )}

      {hasMore && !loading && (
        <div className="text-center">
          <button className="btn-ghost" onClick={() => void load(false)}>
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

function When({ a }: { a: Row }) {
  if (a.status === "live")
    return (
      <>
        Ends in <Countdown endsAt={a.ends_at} className="font-semibold text-stone-900" />
      </>
    );
  if (a.status === "paused") return <>Paused by host</>;
  if (a.status === "scheduled") return <>Starts {dateTime(a.starts_at)}</>;
  return <>Ended {dateTime(a.ends_at)}</>;
}

function Cover({ a, className }: { a: Row; className: string }) {
  return a.cover_url ? (
    <img src={a.cover_url} alt="" className={`${className} object-cover`} loading="lazy" />
  ) : (
    <div className={`${className} flex items-center justify-center bg-gradient-to-br from-stone-200 via-stone-100 to-brand-100`}>
      <span className="font-display text-4xl font-extrabold text-stone-300">{a.title.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

function FeaturedCard({ a }: { a: Row }) {
  return (
    <Link to={`/a/${a.id}`} className="card group grid overflow-hidden transition hover:shadow-xl md:grid-cols-[1.4fr_1fr]">
      <Cover a={a} className="aspect-[16/9] h-full w-full md:aspect-auto md:min-h-72" />
      <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <AuctionBadge status={a.status} />
          <span className="text-xs font-medium text-stone-500">Featured · {a.lots[0]?.count ?? 0} lots</span>
        </div>
        <h2 className="font-display text-2xl font-bold tracking-tight group-hover:underline sm:text-3xl">{a.title}</h2>
        {a.description && <p className="line-clamp-3 text-sm text-stone-600">{a.description}</p>}
        <p className="text-sm text-stone-500">
          <When a={a} />
        </p>
        <span className="btn-accent mt-2 self-start">Join the room</span>
      </div>
    </Link>
  );
}

function AuctionCard({ a }: { a: Row }) {
  return (
    <Link to={`/a/${a.id}`} className="card group flex animate-rise flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="relative">
        <Cover a={a} className="aspect-[4/3] w-full" />
        <div className="absolute top-3 left-3 flex gap-1.5">
          <AuctionBadge status={a.status} />
          {a.mode === "league" && <span className="chip bg-violet-600 text-snow">League</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="line-clamp-2 font-semibold leading-snug group-hover:underline">{a.title}</h3>
        {a.category && (
          <p className="flex items-center gap-1 text-xs text-stone-500">
            <CategoryIcon name={a.category} className="h-3.5 w-3.5" /> {categoryLabel(a.category)}
          </p>
        )}
        <p className="mt-auto flex items-center justify-between pt-2 text-xs text-stone-500">
          <span>
            <When a={a} />
          </span>
          <span>{a.lots[0]?.count ?? 0} lots</span>
        </p>
      </div>
    </Link>
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
  auctions: { settings: AuctionSettings };
};

/** Hero board: the hottest open lots right now, refreshed every 20 seconds. */
function LiveBoard() {
  const [lots, setLots] = useState<BoardLot[]>([]);
  useEffect(() => {
    const load = () =>
      void supabase
        .from("lots")
        .select("id, title, current_bid, start_price, bid_count, ends_at, auction_id, auctions!inner(settings, visibility, status)")
        .eq("status", "open")
        .eq("auctions.visibility", "public")
        .eq("auctions.status", "live")
        .order("bid_count", { ascending: false })
        .limit(4)
        .then(({ data }) => setLots((data as unknown as BoardLot[] | null) ?? []));
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  if (lots.length === 0) return null;
  return (
    <div className="rounded-2xl bg-snow/5 p-2 ring-1 ring-snow/10">
      <p className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wider text-snow/60 uppercase">On the block now</p>
      <ul>
        {lots.map((l) => (
          <li key={l.id}>
            <Link to={`/a/${l.auction_id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-snow/10">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{l.title}</span>
                <span className="text-xs text-snow/60">
                  {l.bid_count} bid{l.bid_count === 1 ? "" : "s"}
                  {l.ends_at && (
                    <>
                      {" · "}
                      <Countdown endsAt={l.ends_at} />
                    </>
                  )}
                </span>
              </span>
              <span className="font-display text-lg font-extrabold text-brand-400 tabular-nums">{money(l.current_bid ?? l.start_price, l.auctions.settings)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
