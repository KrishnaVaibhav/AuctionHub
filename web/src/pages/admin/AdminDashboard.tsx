import { EventsTab } from "./EventsTab";
import { XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { supabase, errorMessage } from "../../lib/supabase";
import { ago, bytes, useIsAdmin } from "../../lib/admin";
import { dateTime } from "../../lib/format";
import { Avatar } from "../../components/Avatar";
import { AuctionBadge } from "../../components/StatusBadge";
import { NotFound } from "../NotFound";
import { SafetyTab } from "./SafetyTab";
import type { AuctionStatus } from "../../lib/types";
import { confirmDialog } from "../../lib/confirm";

type Tab = "overview" | "users" | "auctions" | "activity" | "safety" | "support" | "audit" | "events";

export function AdminDashboard() {
  const { isAdmin, checked } = useIsAdmin();
  const [tab, setTab] = useState<Tab>("overview");

  if (!checked) return <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />;
  if (!isAdmin) return <NotFound />;

  const tabs: [Tab, string][] = [
    ["overview", "Overview"],
    ["users", "Users"],
    ["auctions", "Auctions"],
    ["activity", "Live activity"],
    ["safety", "Safety"],
    ["events", "Events"],
    ["support", "Support"],
    ["audit", "Audit log"],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="chip bg-red-600 text-snow">Super admin</span>
          <h1 className="page-title mt-2">Platform control</h1>
          <p className="text-sm text-stone-500">Everything on AuctionHub. Only platform admins can open this page.</p>
        </div>
      </div>
      <div className="sticky top-[4.75rem] z-20 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="glass segmented scrollbar-none max-w-full overflow-x-auto">
          {tabs.map(([k, label]) => (
            <button key={k} className={`tab ${tab === k ? "tab-active" : ""}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "overview" && <Overview />}
      {tab === "users" && <Users />}
      {tab === "auctions" && <Auctions />}
      {tab === "activity" && <Activity />}
      {tab === "safety" && <SafetyTab />}
      {tab === "support" && <SupportInbox />}
      {tab === "audit" && <Audit />}
      {tab === "events" && <EventsTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
interface OverviewData {
  users: number;
  users_24h: number;
  active_24h: number;
  banned: number;
  auctions_by_status: Record<string, number>;
  auctions_by_visibility: Record<string, number>;
  leagues: number;
  lots: number;
  lots_sold: number;
  sales_total: number;
  bids: number;
  bids_24h: number;
  chat_24h: number;
  deal_messages: number;
  teams: number;
  db_bytes: number;
  db_limit_bytes: number;
  storage_bytes: number;
  storage_limit_bytes: number;
  storage_by_bucket: Record<string, { files: number; bytes: number }>;
  tables: { table: string; rows: number; bytes: number }[];
  cron: { job: string; schedule: string; active: boolean; last_run: string | null; last_status: string | null; failures_24h: number; last_error: string | null }[];
  server_time: string;
}

function useRpc<T>(fn: string, args: Record<string, unknown> = {}, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(args);
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc(fn, JSON.parse(key));
    if (error) setError(errorMessage(error));
    else {
      setError(null);
      setData(data as T);
    }
  }, [fn, key]);
  useEffect(() => {
    void load();
    if (!refreshMs) return;
    const id = setInterval(() => void load(), refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);
  return { data, error, reload: load };
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">{label}</p>
      <p className="mt-1 truncate font-display text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
    </div>
  );
}

function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  const color = pct > 85 ? "bg-red-500" : pct > 65 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-sm tabular-nums text-stone-500">
          {bytes(used)} / {bytes(limit)} ({pct.toFixed(1)}%)
        </p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Overview() {
  const { data: d, error } = useRpc<OverviewData>("admin_overview", {}, 30_000);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />;
  const byStatus = d.auctions_by_status;
  const totalAuctions = Object.values(byStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="animate-rise space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Users" value={d.users} sub={`+${d.users_24h} today · ${d.active_24h} active 24h · ${d.banned} banned`} />
        <Stat label="Auctions" value={totalAuctions} sub={`${byStatus.live ?? 0} live · ${d.leagues} leagues`} />
        <Stat label="Bids" value={d.bids} sub={`${d.bids_24h} in last 24h`} />
        <Stat label="Lots sold" value={`${d.lots_sold}/${d.lots}`} sub={`Sales ${Number(d.sales_total).toLocaleString()}`} />
        <Stat label="Chat 24h" value={d.chat_24h} />
        <Stat label="Deal messages" value={d.deal_messages} />
        <Stat label="League teams" value={d.teams} />
        <Stat label="Visibility" value={`${d.auctions_by_visibility.public ?? 0} / ${d.auctions_by_visibility.unlisted ?? 0} / ${d.auctions_by_visibility.private ?? 0}`} sub="public / unlisted / private" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Usage label="Database (free tier 500 MB)" used={d.db_bytes} limit={d.db_limit_bytes} />
        <Usage label="Storage (free tier 1 GB)" used={d.storage_bytes} limit={d.storage_limit_bytes} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card overflow-hidden">
          <p className="border-b border-stone-900/[0.06] px-4 py-3 font-semibold">Scheduled jobs</p>
          <ul className="divide-y divide-stone-900/[0.06] text-sm">
            {d.cron.map((c) => (
              <li key={c.job} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${c.failures_24h > 0 ? "bg-red-500" : c.active ? "bg-emerald-500" : "bg-stone-400"}`} />
                  <span className="font-medium">{c.job}</span>
                  <span className="font-mono text-xs text-stone-500">{c.schedule}</span>
                  <span className="ml-auto text-xs text-stone-500">
                    {c.last_status ?? "-"} · {ago(c.last_run)}
                  </span>
                </div>
                {c.failures_24h > 0 && (
                  <p className="mt-1 truncate text-xs text-red-600">
                    {c.failures_24h} failures in 24h: {c.last_error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="card overflow-hidden">
          <p className="border-b border-stone-900/[0.06] px-4 py-3 font-semibold">Storage buckets</p>
          <ul className="divide-y divide-stone-900/[0.06] text-sm">
            {Object.entries(d.storage_by_bucket).map(([b, v]) => (
              <li key={b} className="flex justify-between px-4 py-2.5">
                <span className="font-medium">{b}</span>
                <span className="tabular-nums text-stone-500">
                  {v.files} files · {bytes(v.bytes)}
                </span>
              </li>
            ))}
            {Object.keys(d.storage_by_bucket).length === 0 && <li className="px-4 py-3 text-stone-500">No files yet.</li>}
          </ul>
        </div>
      </div>

      <div className="card overflow-hidden">
        <p className="border-b border-stone-900/[0.06] px-4 py-3 font-semibold">Tables (largest first)</p>
        <div className="overflow-x-auto">
          <table className="table w-full text-sm">
            <thead className="text-left text-[11px] tracking-wider text-stone-500 uppercase">
              <tr>
                <th className="px-4 py-2">Table</th>
                <th className="px-4 py-2 text-right">Rows (approx.)</th>
                <th className="px-4 py-2 text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-900/[0.06]">
              {d.tables.map((t) => (
                <tr key={t.table}>
                  <td className="px-4 py-2 font-mono text-xs">{t.table}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{t.rows.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{bytes(t.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-stone-500">Refreshes every 30 s. Server time {dateTime(d.server_time)}.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
interface AdminUser {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  provider: string;
  provider_name: string | null;
  provider_avatar: string | null;
  phone: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  banned_until: string | null;
  is_admin: boolean;
  auctions_hosted: number;
  bids: number;
  lots_won: number;
  share_contact: boolean;
  total_count: number;
}

const PAGE = 50;

function ProviderPhoto({ url, name, size }: { url: string | null; name: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) {
    return (
      <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-stone-100 text-[11px] text-stone-500">
        {url ? "error" : "none"}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" title={name ?? "Sign-in photo"}>
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover ring-1 ring-stone-200"
      />
    </a>
  );
}

function Users() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, reload } = useRpc<AdminUser[]>("admin_users", { p_search: q || null, p_limit: PAGE, p_offset: page * PAGE });
  const total = data?.[0]?.total_count ?? 0;

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="animate-rise space-y-4">
      <input className="input max-w-md" type="search" placeholder="Search email, username, name or user id..." value={search} onChange={(e) => setSearch(e.target.value)} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="table w-full min-w-[62rem] text-sm">
          <thead className="text-left text-[11px] tracking-wider text-stone-500 uppercase">
            <tr>
              <th className="px-4 py-2.5">Sign-in photo</th>
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Joined</th>
              <th className="px-4 py-2.5">Last sign-in</th>
              <th className="px-4 py-2.5 text-right">Hosted</th>
              <th className="px-4 py-2.5 text-right">Bids</th>
              <th className="px-4 py-2.5 text-right">Won</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-900/[0.06]">
            {(data ?? []).map((u) => {
              const banned = u.banned_until && new Date(u.banned_until) > new Date();
              return (
                <tr key={u.id} className="cursor-pointer hover:bg-stone-900/[0.03]" onClick={() => setSelected(u.id)}>
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <ProviderPhoto url={u.provider_avatar} name={u.provider_name} size={36} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={u.display_name} url={u.avatar_url} size={28} />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{u.display_name ?? "(no profile)"}</p>
                        <p className="truncate text-xs text-stone-500">@{u.username}</p>
                        {u.provider_name && <p className="truncate text-xs text-stone-600">Real name: {u.provider_name}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="truncate">{u.email}</p>
                    <p className="text-xs text-stone-500">
                      {u.provider}
                      {!u.email_confirmed && " · unconfirmed"}
                      {u.phone && ` · ${u.phone}`}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{ago(u.created_at)}</td>
                  <td className="px-4 py-2.5 text-xs text-stone-500">{ago(u.last_sign_in_at)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.auctions_hosted}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.bids}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{u.lots_won}</td>
                  <td className="px-4 py-2.5">
                    {u.is_admin && <span className="chip mr-1 bg-red-600 text-snow">admin</span>}
                    {banned ? <span className="chip bg-red-100 text-red-700">banned</span> : <span className="chip bg-emerald-100 text-emerald-800">active</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} onPage={setPage} />
      {selected && (
        <UserDetail
          userId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            void reload();
          }}
        />
      )}
    </div>
  );
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  return (
    <div className="flex items-center justify-between text-sm text-stone-500">
      <span>{total} total</span>
      <div className="flex items-center gap-2">
        <button className="btn-ghost py-1" disabled={page === 0} onClick={() => onPage(page - 1)}>
          Prev
        </button>
        <span>
          {page + 1} / {pages}
        </span>
        <button className="btn-ghost py-1" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

type Json = Record<string, unknown>;

function UserDetail({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload } = useRpc<Json>("admin_user_detail", { p_user_id: userId });
  const [msg, setMsg] = useState<string | null>(null);
  const profile = (data?.profile ?? {}) as Json;
  const account = (data?.account ?? {}) as Json;
  const banned = profile.banned_until && new Date(String(profile.banned_until)) > new Date();

  async function ban(days: number | null) {
    const until = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
    const reason = days === null ? null : window.prompt("Reason (optional):") ?? null;
    const { error } = await supabase.rpc("admin_set_ban", { p_user_id: userId, p_until: until, p_reason: reason });
    setMsg(error ? errorMessage(error) : days === null ? "Unbanned" : `Banned for ${days} days`);
    await reload();
    onChanged();
  }

  const list = (k: string) => (Array.isArray(data?.[k]) ? (data?.[k] as Json[]) : []);

  return createPortal(
    <div className="scrim flex justify-end" onClick={onClose}>
      <div className="glass-thick h-full w-full max-w-2xl animate-rise overflow-y-auto p-5 sm:rounded-l-[32px] sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <ProviderPhoto url={(data?.provider_avatar as string) ?? null} name={(data?.provider_name as string) ?? null} size={64} />
            <Avatar name={String(profile.display_name ?? "?")} url={(profile.avatar_url as string) ?? null} size={40} />
            <div>
              <p className="font-display text-xl font-bold">{String(profile.display_name ?? "(no profile)")}</p>
              {typeof data?.provider_name === "string" && <p className="text-sm">Real name: {data.provider_name}</p>}
              <p className="text-sm text-stone-500">
                {String(account.email ?? "")} · @{String(profile.username ?? "")}
              </p>
            </div>
          </div>
          <button className="btn-ghost h-9 w-9 p-0" onClick={onClose} aria-label="Close">
            <XIcon size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {banned ? (
            <button className="btn-accent" onClick={() => void ban(null)}>
              Unban (banned until {dateTime(String(profile.banned_until))})
            </button>
          ) : (
            <>
              <button className="btn-ghost" onClick={() => void ban(1)}>
                Ban 1 day
              </button>
              <button className="btn-ghost" onClick={() => void ban(7)}>
                Ban 7 days
              </button>
              <button className="btn-danger" onClick={() => void ban(36500)}>
                Ban permanently
              </button>
            </>
          )}
          {msg && <span className="self-center text-sm text-stone-600">{msg}</span>}
        </div>

        <Section title="Account">
          <pre className="overflow-x-auto rounded-2xl bg-stone-900/[0.05] p-3 text-xs">{JSON.stringify(account, null, 2)}</pre>
        </Section>
        <Section title={`Sign-in methods (${list("identities").length})`}>
          {list("identities").map((i, n) => (
            <div key={n} className="py-2">
              <p className="text-sm font-medium">
                {String(i.provider)} · {String(i.email ?? "")} · last used {ago(String(i.last_sign_in_at ?? ""))}
              </p>
              <pre className="mt-1 overflow-x-auto rounded-2xl bg-stone-900/[0.05] p-3 text-xs">{JSON.stringify(i.data, null, 2)}</pre>
            </div>
          ))}
        </Section>
        <Section title={`Sessions (${list("sessions").length})`}>
          {list("sessions").map((x, n) => (
            <p key={n} className="py-1.5 text-xs">
              <span className="font-mono">{String(x.ip ?? "no ip")}</span> · {String(x.user_agent ?? "unknown device")}
              <span className="block text-stone-500">
                started {dateTime(String(x.created_at))} · last active {ago(String(x.refreshed_at ?? x.updated_at ?? x.created_at))}
              </span>
            </p>
          ))}
        </Section>
        <Section title={`Sign-in history (${list("auth_events").length})`}>
          {list("auth_events").map((e, n) => (
            <p key={n} className="flex justify-between gap-2 py-1 text-xs">
              <span>
                {String(e.action)} {e.provider ? `(${String(e.provider)})` : ""}
              </span>
              <span className="text-stone-500">
                {String(e.ip ?? "")} · {dateTime(String(e.at))}
              </span>
            </p>
          ))}
        </Section>
        <Section title="Private contact settings">
          <pre className="overflow-x-auto rounded-2xl bg-stone-900/[0.05] p-3 text-xs">{JSON.stringify(data?.contact ?? null, null, 2)}</pre>
        </Section>
        <Section title={`Auctions hosted (${list("auctions").length})`}>
          {list("auctions").map((a) => (
            <Link key={String(a.id)} to={`/a/${a.id}`} className="flex justify-between py-1 text-sm hover:underline">
              <span>{String(a.title)}</span>
              <span className="text-xs text-stone-500">
                {String(a.status)} · {String(a.mode)} · {String(a.visibility)}
              </span>
            </Link>
          ))}
        </Section>
        <Section title={`Wins (${list("wins").length})`}>
          {list("wins").map((w, i) => (
            <p key={i} className="flex justify-between py-1 text-sm">
              <span>{String(w.lot)}</span>
              <span className="tabular-nums">{String(w.price)}</span>
            </p>
          ))}
        </Section>
        <Section title={`League teams (${list("teams").length})`}>
          {list("teams").map((t, i) => (
            <p key={i} className="py-1 text-sm">
              {String(t.short)} · {String(t.name)} · purse left {String(t.purse_left)}
            </p>
          ))}
        </Section>
        <Section title={`Recent bids (${list("bids").length})`}>
          {list("bids").map((b) => (
            <p key={String(b.id)} className="flex justify-between py-1 text-sm">
              <span className="truncate">
                {String(b.lot)} {b.is_auto ? "(auto)" : ""}
              </span>
              <span className="shrink-0 tabular-nums">
                {String(b.amount)} · {ago(String(b.created_at))}
              </span>
            </p>
          ))}
        </Section>
        <Section title={`Chat messages (${list("chat").length})`}>
          {list("chat").map((c) => (
            <p key={String(c.id)} className={`py-1 text-sm ${c.deleted ? "text-stone-500 line-through" : ""}`}>
              {String(c.body)} <span className="text-xs text-stone-500">· {ago(String(c.created_at))}</span>
            </p>
          ))}
        </Section>
        <Section title={`Support requests (${list("support").length})`}>
          {list("support").map((r) => (
            <p key={String(r.id)} className="py-1 text-sm">
              <span className="text-stone-500">
                [{String(r.category)} · {String(r.status)}]
              </span>{" "}
              {String(r.message)}
            </p>
          ))}
        </Section>
        <Section title={`Deal chat messages (${list("deal_messages").length})`}>
          {list("deal_messages").map((d) => (
            <p key={String(d.id)} className="py-1 text-sm">
              <span className="text-stone-500">[{String(d.lot)}]</span> {String(d.body)}
            </p>
          ))}
        </Section>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <p className="label">{title}</p>
      <div className="divide-y divide-stone-900/[0.06]">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auctions
// ---------------------------------------------------------------------------
interface AdminAuction {
  id: string;
  title: string;
  status: AuctionStatus;
  mode: string;
  visibility: string;
  host_id: string;
  host_name: string;
  host_email: string;
  created_at: string;
  lots: number;
  bids: number;
  sold_total: number;
  members: number;
  invite_code: string | null;
  total_count: number;
}

function Auctions() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error, reload } = useRpc<AdminAuction[]>("admin_auctions", { p_search: q || null, p_status: status || null, p_limit: PAGE, p_offset: page * PAGE });
  const total = data?.[0]?.total_count ?? 0;

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  async function act(fn: "admin_cancel_auction" | "admin_delete_auction", a: AdminAuction) {
    const verb = fn === "admin_cancel_auction" ? "Cancel" : "Permanently delete";
    if (!(await confirmDialog({ title: `${verb} "${a.title}"?`, body: "This is recorded in the audit log.", confirmLabel: fn === "admin_cancel_auction" ? "Cancel auction" : "Delete auction", cancelLabel: "Keep", danger: true })))
      return;
    const reason = window.prompt("Reason (optional, stored in the audit log):");
    const { error } = await supabase.rpc(fn, { p_auction_id: a.id, p_reason: reason });
    setMsg(error ? errorMessage(error) : `${verb}d "${a.title}"`);
    await reload();
  }

  return (
    <div className="animate-rise space-y-4">
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-md" type="search" placeholder="Search title, host name, host email or id..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(0))}>
          <option value="">All statuses</option>
          {["draft", "scheduled", "live", "paused", "ended", "cancelled"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {(error || msg) && <p className={`text-sm ${error ? "text-red-600" : "text-stone-600"}`}>{error ?? msg}</p>}
      <div className="card overflow-x-auto">
        <table className="table w-full min-w-[60rem] text-sm">
          <thead className="text-left text-[11px] tracking-wider text-stone-500 uppercase">
            <tr>
              <th className="px-4 py-2.5">Auction</th>
              <th className="px-4 py-2.5">Host</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Lots</th>
              <th className="px-4 py-2.5 text-right">Bids</th>
              <th className="px-4 py-2.5 text-right">Sold</th>
              <th className="px-4 py-2.5">Access</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-900/[0.06]">
            {(data ?? []).map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2.5">
                  <Link to={`/a/${a.id}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  <p className="text-xs text-stone-500">
                    {a.mode} · created {ago(a.created_at)}
                  </p>
                </td>
                <td className="px-4 py-2.5">
                  <p className="truncate">{a.host_name}</p>
                  <p className="truncate text-xs text-stone-500">{a.host_email}</p>
                </td>
                <td className="px-4 py-2.5">
                  <AuctionBadge status={a.status} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{a.lots}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{a.bids}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{Number(a.sold_total).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-xs">
                  {a.visibility}
                  {a.visibility === "private" && (
                    <span className="block text-stone-500">
                      code {a.invite_code ?? "-"} · {a.members} members
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  {!["ended", "cancelled"].includes(a.status) && (
                    <button className="btn-ghost mr-1 py-1 text-xs" onClick={() => void act("admin_cancel_auction", a)}>
                      Cancel
                    </button>
                  )}
                  <button className="btn-ghost py-1 text-xs text-red-600" onClick={() => void act("admin_delete_auction", a)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} onPage={setPage} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live activity + audit
// ---------------------------------------------------------------------------
interface ActivityRow {
  at: string;
  kind: string;
  actor_id: string | null;
  actor: string | null;
  summary: string;
  auction_id: string | null;
}

const kindStyle: Record<string, string> = {
  signup: "bg-sky-100 text-sky-800",
  bid: "bg-emerald-100 text-emerald-800",
  chat: "bg-stone-100 text-stone-700",
  deal: "bg-violet-100 text-violet-800",
  auction: "bg-brand-100 text-brand-700",
  admin: "bg-red-100 text-red-700",
};

function Activity() {
  const { data, error } = useRpc<ActivityRow[]>("admin_activity", { p_limit: 200 }, 10_000);
  const [filter, setFilter] = useState("all");
  const rows = (data ?? []).filter((r) => filter === "all" || r.kind === filter);
  return (
    <div className="animate-rise space-y-4">
      <div className="flex flex-wrap gap-1">
        {["all", "signup", "auction", "bid", "chat", "deal", "admin"].map((k) => (
          <button key={k} className={`tab ${filter === k ? "tab-active bg-stone-100" : ""}`} onClick={() => setFilter(k)}>
            {k}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-stone-500">Refreshes every 10 s</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="card divide-y divide-stone-900/[0.06]">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span className={`chip mt-0.5 shrink-0 ${kindStyle[r.kind] ?? "bg-stone-100"}`}>{r.kind}</span>
            <div className="min-w-0 flex-1">
              <p className="break-words">
                {r.actor && <span className="font-semibold">{r.actor}: </span>}
                {r.summary}
              </p>
              {r.auction_id && (
                <Link to={`/a/${r.auction_id}`} className="text-xs text-sky-700 hover:underline">
                  open auction
                </Link>
              )}
            </div>
            <span className="shrink-0 text-xs text-stone-500">{ago(r.at)}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-stone-500">No activity.</p>}
      </div>
    </div>
  );
}

interface AuditRow {
  id: number;
  admin_id: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => {
    void supabase
      .from("admin_audit_log")
      .select("*")
      .order("id", { ascending: false })
      .limit(200)
      .then(({ data }) => setRows((data as AuditRow[] | null) ?? []));
  }, []);
  return (
    <div className="card animate-rise divide-y divide-stone-900/[0.06]">
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
          <span className="chip bg-red-100 text-red-700">{r.action}</span>
          <span className="font-mono text-xs">{r.target}</span>
          <span className="text-xs text-stone-500">{JSON.stringify(r.details)}</span>
          <span className="ml-auto text-xs text-stone-500">{dateTime(r.created_at)}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-stone-500">No admin actions yet.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Support inbox
// ---------------------------------------------------------------------------
interface SupportRow {
  id: number;
  created_at: string;
  category: string;
  message: string;
  contact: string | null;
  status: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
}

function SupportInbox() {
  const [status, setStatus] = useState("open");
  const { data, error, reload } = useRpc<SupportRow[]>("admin_support", { p_status: status }, 30_000);

  async function setRowStatus(id: number, next: string) {
    await supabase.from("support_requests").update({ status: next }).eq("id", id);
    await reload();
  }

  return (
    <div className="animate-rise space-y-4">
      <div className="segmented">
        {["open", "resolved", ""].map((s) => (
          <button key={s || "all"} className={`tab ${status === s ? "tab-active" : ""}`} onClick={() => setStatus(s)}>
            {s || "all"}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="space-y-3">
        {(data ?? []).map((r) => (
          <div key={r.id} className="card space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="chip bg-stone-100 text-stone-700">{r.category}</span>
              <span className={`chip ${r.status === "open" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{r.status}</span>
              <span className="text-stone-500">{dateTime(r.created_at)}</span>
              <span className="ml-auto text-stone-500">
                {r.user_id ? `${r.user_name ?? "user"} · ${r.user_email ?? ""}` : "anonymous"}
                {r.contact && ` · reply to: ${r.contact}`}
              </span>
            </div>
            <p className="text-sm break-words whitespace-pre-line">{r.message}</p>
            <button className="btn-ghost py-1 text-xs" onClick={() => void setRowStatus(r.id, r.status === "open" ? "resolved" : "open")}>
              Mark {r.status === "open" ? "resolved" : "open"}
            </button>
          </div>
        ))}
        {(data ?? []).length === 0 && <p className="card px-4 py-6 text-center text-sm text-stone-500">No requests.</p>}
      </div>
    </div>
  );
}
