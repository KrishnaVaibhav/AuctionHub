import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { MagnifyingGlassIcon, PlusIcon, WebhooksLogoIcon } from "@phosphor-icons/react";
import { useAuth } from "../../lib/auth";
import { WebhooksPanel } from "./WebhooksPanel";
import { supabase, errorMessage } from "../../lib/supabase";
import { dateTime } from "../../lib/format";
import type { Auction } from "../../lib/types";
import { AuctionBadge } from "../../components/StatusBadge";
import { canDelete, deleteAuctionCompletely, visibilityLabel } from "../../lib/auctions";
import { confirmDialog } from "../../lib/confirm";
import { Menu } from "../../components/Menu";
import { CategoryIcon } from "../../components/CategoryIcon";
import { TEMPLATES } from "../../lib/templates";

type Row = Auction & { lots: { count: number }[]; sold?: { count: number }[] };
type Filter = "all" | "live" | "next" | "draft" | "done";

const FILTERS: { key: Filter; label: string; match: (a: Auction) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "live", label: "Live", match: (a) => a.status === "live" || a.status === "paused" },
  { key: "next", label: "Up next", match: (a) => a.status === "scheduled" },
  { key: "draft", label: "Drafts", match: (a) => a.status === "draft" },
  { key: "done", label: "Finished", match: (a) => a.status === "ended" || a.status === "cancelled" },
];

// What needs you first: running auctions, then the next to start, then drafts, then history.
const rank: Record<Auction["status"], number> = { live: 0, paused: 0, scheduled: 1, draft: 2, ended: 3, cancelled: 4 };
const time = (s: string | null) => (s ? new Date(s).getTime() : 0);
function byUrgency(a: Auction, b: Auction): number {
  if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
  if (a.status === "scheduled") return time(a.starts_at) - time(b.starts_at);
  if (a.status === "ended" || a.status === "cancelled") return time(b.ends_at) - time(a.ends_at);
  return time(b.created_at) - time(a.created_at);
}

const lotCount = (a: Row) => a.lots?.[0]?.count ?? 0;
const soldCount = (a: Row) => a.sold?.[0]?.count;

export function HostDashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cohosted, setCohosted] = useState<Auction[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const userId = session!.user.id;

  useEffect(() => {
    void (async () => {
      // Lot counts, plus how many sold (falls back to plain counts if the server can't filter the embed).
      let res = await supabase.from("auctions").select("*, lots(count), sold:lots(count)").eq("host_id", userId).eq("sold.status", "sold");
      if (res.error) res = await supabase.from("auctions").select("*, lots(count)").eq("host_id", userId);
      if (res.error) setError(errorMessage(res.error));
      setRows((res.data as Row[] | null) ?? []);
    })();
    void supabase.rpc("my_cohosted_auctions").then(({ data }) => setCohosted((data as Auction[] | null) ?? []));
  }, [userId]);

  async function duplicate(a: Row) {
    setError(null);
    const { data, error } = await supabase.rpc("duplicate_auction", { p_auction_id: a.id });
    if (error) setError(errorMessage(error));
    else navigate(`/host/a/${data}?tab=details`);
  }

  async function remove(a: Row) {
    const ok = await confirmDialog({
      title: `Delete "${a.title}"?`,
      body: "All its lots, bids, chat and files are removed. This can't be undone.",
      confirmLabel: "Delete auction",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await deleteAuctionCompletely(a);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== a.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const all = rows ?? [];
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, all.filter(f.match).length])) as Record<Filter, number>, [all]);
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    return all.filter((a) => f.match(a) && (!q || a.title.toLowerCase().includes(q))).sort(byUrgency);
  }, [all, filter, query]);

  return (
    <div className="space-y-8">
      <header className="enter flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Host dashboard</h1>
          <p className="page-sub">Your auctions, what needs you next, and how they went.</p>
        </div>
        <Link to="/host/new" className="btn-accent px-5 py-2.5 text-base">
          <PlusIcon size={18} weight="bold" aria-hidden="true" />
          New auction
        </Link>
      </header>

      {error && <p className="rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      {rows === null ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-[22px] bg-stone-200/60" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <FirstAuction />
      ) : (
        <section className="space-y-4" aria-label="Your auctions">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="segmented scrollbar-none max-w-full overflow-x-auto" role="tablist" aria-label="Show auctions">
              {FILTERS.map((f) => (
                <button key={f.key} role="tab" aria-selected={filter === f.key} className={`tab ${filter === f.key ? "tab-active" : ""}`} onClick={() => setFilter(f.key)}>
                  {f.label}
                  <span className="ml-1.5 text-xs text-stone-500 tabular-nums">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            {all.length > 4 && (
              <label className="relative sm:w-64">
                <MagnifyingGlassIcon size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-500" aria-hidden="true" />
                <input className="input rounded-full pl-10" type="search" placeholder="Find an auction" aria-label="Find an auction" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            )}
          </div>

          {shown.length === 0 ? (
            <div className="card px-6 py-12 text-center text-sm text-stone-500">Nothing here{query ? ` for "${query}"` : ""}.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
              {shown.map((a, i) => (
                <AuctionCard key={a.id} a={a} i={i} onDuplicate={() => void duplicate(a)} onDelete={() => void remove(a)} />
              ))}
            </div>
          )}
        </section>
      )}

      {cohosted.length > 0 && (
        <section className="space-y-4">
          <h2 className="section-title px-1">Co-hosting</h2>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
            {[...cohosted].sort(byUrgency).map((a, i) => (
              <AuctionCard key={a.id} a={a as Row} i={i} cohost />
            ))}
          </div>
        </section>
      )}

      {/* Advanced and rarely changed: tucked away so it doesn't crowd your auctions. */}
      <details className="card group p-5">
        <summary className="flex cursor-pointer items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-stone-900/[0.05] text-stone-700 dark:bg-snow/[0.06]">
            <WebhooksLogoIcon size={20} weight="bold" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-semibold">Integrations</span>
            <span className="block text-sm text-stone-500">Webhooks for Zapier, Make, n8n or your own server</span>
          </span>
        </summary>
        <div className="mt-4">
          <WebhooksPanel />
        </div>
      </details>
    </div>
  );
}

/** One auction: a picture, what state it's in, and the one thing to do next. */
function AuctionCard({ a, i, cohost, onDuplicate, onDelete }: { a: Row; i: number; cohost?: boolean; onDuplicate?: () => void; onDelete?: () => void }) {
  const navigate = useNavigate();
  const lots = lotCount(a);
  const sold = soldCount(a);
  const noun = a.mode === "league" ? (lots === 1 ? "player" : "players") : lots === 1 ? "lot" : "lots";
  const running = a.status === "live" || a.status === "paused";
  const finished = a.status === "ended" || a.status === "cancelled";

  const facts =
    running
      ? `${a.status === "paused" ? "Paused" : "Live now"} · ${lots} ${noun}${sold != null ? ` · ${sold} sold` : ""}`
      : a.status === "scheduled"
        ? `Starts ${dateTime(a.starts_at)} · ${lots} ${noun}`
        : a.status === "draft"
          ? `${lots} ${noun}${a.starts_at ? ` · set to start ${dateTime(a.starts_at)}` : ""}`
          : a.status === "cancelled"
            ? "Cancelled"
            : `Ended ${dateTime(a.ends_at)}${sold != null ? ` · ${sold} of ${lots} sold` : ` · ${lots} ${noun}`}`;

  const next =
    a.status === "draft" && !cohost
      ? lots === 0
        ? { label: "Add lots", to: `/host/a/${a.id}?tab=lots`, tone: "bg-amber-100 text-amber-800", hint: `Next: add ${a.mode === "league" ? "players" : "lots"}` }
        : { label: "Continue setup", to: `/host/a/${a.id}`, tone: "bg-emerald-100 text-emerald-800", hint: "Ready to go live" }
      : null;

  const primary = running
    ? { label: "Run the room", to: `/a/${a.id}`, cls: "btn-accent" }
    : next
      ? { label: next.label, to: next.to, cls: "btn-accent" }
      : finished && !cohost
        ? { label: "See results", to: `/host/a/${a.id}?tab=results`, cls: "btn-primary" }
        : a.status === "scheduled"
          ? { label: "Open room", to: `/a/${a.id}`, cls: "btn-primary" }
          : { label: cohost ? "Manage" : "Edit", to: `/host/a/${a.id}`, cls: "btn-primary" };

  return (
    <article className="reveal card group flex flex-col overflow-hidden" style={{ ["--i" as string]: i % 4 }}>
      <Link to={primary.to} className="relative block aspect-[16/7] overflow-hidden" tabIndex={-1} aria-hidden="true">
        {a.cover_url ? (
          <img src={a.cover_url} alt="" className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-200 via-orange-100 to-rose-200">
            <CategoryIcon name={a.category ?? "Other"} className="h-10 w-10 text-ink/30" />
          </div>
        )}
        <span className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <AuctionBadge status={a.status} />
          {a.mode === "league" && <span className="chip bg-violet-600 text-snow">League</span>}
          {a.visibility !== "public" && <span className="chip bg-ink/80 text-snow">{visibilityLabel[a.visibility]}</span>}
          {cohost && <span className="chip bg-sky-600 text-snow">Co-host</span>}
        </span>
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-lg leading-snug font-semibold">
          <Link to={primary.to} className="hover:underline">
            {a.title}
          </Link>
        </h3>
        <p className="text-sm text-stone-600">{facts}</p>
        {next && <span className={`chip self-start ${next.tone}`}>{next.hint}</span>}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Link to={primary.to} className={`${primary.cls} flex-1`}>
            {primary.label}
          </Link>
          {!cohost && (
            <Menu
              label={`More actions for ${a.title}`}
              items={[
                { label: "Open room", onSelect: () => navigate(`/a/${a.id}`), hidden: primary.to === `/a/${a.id}` },
                { label: "Edit settings", onSelect: () => navigate(`/host/a/${a.id}?tab=details`) },
                { label: "Lots", onSelect: () => navigate(`/host/a/${a.id}?tab=lots`) },
                { label: "Results", onSelect: () => navigate(`/host/a/${a.id}?tab=results`), hidden: a.status === "draft" || primary.label === "See results" },
                { label: "Duplicate", onSelect: () => onDuplicate?.() },
                { label: "Delete", onSelect: () => onDelete?.(), danger: true, hidden: !canDelete(a.status) },
              ]}
            />
          )}
          {cohost &&
            (primary.to === `/a/${a.id}` ? (
              <Link to={`/host/a/${a.id}`} className="btn-ghost">
                Manage
              </Link>
            ) : (
              <Link to={`/a/${a.id}`} className="btn-ghost">
                Open room
              </Link>
            ))}
        </div>
      </div>
    </article>
  );
}

/** Before the first auction: the formats, one click each. */
function FirstAuction() {
  return (
    <section className="card space-y-5 p-6 sm:p-8">
      <div>
        <h2 className="font-display text-2xl font-extrabold tracking-tight">Run your first auction</h2>
        <p className="mt-1 text-stone-600">Pick a format to start. It only sets the rules up for you; you can change any of them later.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {TEMPLATES.map((t) => (
          <Link key={t.key} to={`/host/new?format=${t.key}`} className="choice block p-4">
            <span className="block font-semibold">{t.title}</span>
            <span className="mt-0.5 block text-sm text-stone-600">{t.blurb}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
