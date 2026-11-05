import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../../lib/auth";
import { WebhooksPanel } from "./WebhooksPanel";
import { supabase, errorMessage } from "../../lib/supabase";
import { dateTime } from "../../lib/format";
import type { Auction } from "../../lib/types";
import { AuctionBadge } from "../../components/StatusBadge";
import { LEAGUE_DEFAULTS, LEAGUE_INCREMENTS } from "../../lib/useLeagueTeams";
import { canDelete, deleteAuctionCompletely, visibilityLabel } from "../../lib/auctions";
import { confirmDialog } from "../../lib/confirm";
import { Menu } from "../../components/Menu";
import { CategoryIcon } from "../../components/CategoryIcon";
import { PlusIcon } from "@phosphor-icons/react";

type Row = Auction & { lots: { count: number }[] };

export function HostDashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [cohosted, setCohosted] = useState<Auction[]>([]);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"standard" | "league">("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = session!.user.id;

  useEffect(() => {
    void supabase
      .from("auctions")
      .select("*, lots(count)")
      .eq("host_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(errorMessage(error));
        setRows((data as Row[] | null) ?? []);
      });
    void supabase.rpc("my_cohosted_auctions").then(({ data }) => setCohosted((data as Auction[] | null) ?? []));
  }, [userId]);

  async function duplicate(a: Row) {
    setError(null);
    const { data, error } = await supabase.rpc("duplicate_auction", { p_auction_id: a.id });
    if (error) setError(errorMessage(error));
    else navigate(`/host/a/${data}`);
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
      setRows((prev) => prev.filter((r) => r.id !== a.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase
      .from("auctions")
      .insert({
        host_id: userId,
        title: title.trim(),
        mode,
        settings:
          mode === "league"
            ? { currency: "INR", compact: true, increments: LEAGUE_INCREMENTS, league: LEAGUE_DEFAULTS, chat: { enabled: true, slow_mode_s: 1 } }
            : { currency: "INR", anti_snipe_seconds: 30, lot_duration_minutes: 10, chat: { enabled: true, slow_mode_s: 2 } },
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) setError(errorMessage(error));
    else navigate(`/host/a/${data.id}`);
  }

  return (
    <div className="space-y-8">
      <header className="enter">
        <h1 className="page-title">Host dashboard</h1>
        <p className="page-sub">Create auctions, add lots and media, then go live.</p>
      </header>

      <form onSubmit={create} className="card enter flex flex-col gap-3 p-5 sm:flex-row sm:items-end" style={{ "--i": 1 } as CSSProperties}>
        <div className="flex-1">
          <label className="label" htmlFor="title">
            New auction title
          </label>
          <input
            id="title"
            className="input"
            required
            minLength={3}
            maxLength={120}
            placeholder="e.g. Vintage watches, Sunday night"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <select className="input sm:w-56" value={mode} onChange={(e) => setMode(e.target.value as "standard" | "league")}>
          <option value="standard">Standard auction</option>
          <option value="league">Team league (IPL-style)</option>
        </select>
        <button className="btn-accent" disabled={busy}>
          <PlusIcon size={16} weight="bold" aria-hidden="true" />
          Create
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="space-y-3">
      <h2 className="section-title px-1">Your auctions</h2>
      <div className="group-list">
        {rows.length === 0 && <p className="p-5 text-sm text-stone-500">No auctions yet. Name one above to get started.</p>}
        {rows.map((a) => (
          <div key={a.id} className="group-row flex-wrap gap-4 py-4">
            <span className="hidden h-11 w-11 flex-none items-center justify-center rounded-2xl bg-brand-100 text-brand-700 sm:flex">
              <CategoryIcon name={a.category ?? "Other"} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <AuctionBadge status={a.status} />
                {a.mode === "league" && <span className="chip bg-violet-100 text-violet-800">League</span>}
                {a.visibility !== "public" && <span className="chip bg-stone-100 text-stone-700">{visibilityLabel[a.visibility]}</span>}
                <span className="text-xs text-stone-500">{a.lots[0]?.count ?? 0} lots</span>
              </div>
              <p className="mt-1 font-semibold">{a.title}</p>
              <p className="text-xs text-stone-500">Starts {dateTime(a.starts_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link to={`/host/a/${a.id}`} className="btn-ghost">
                Edit
              </Link>
              <Link to={`/a/${a.id}`} className="btn-primary">
                Open room
              </Link>
              <Menu
                label={`More actions for ${a.title}`}
                items={[
                  { label: "Results", onSelect: () => navigate(`/a/${a.id}?tab=results`), hidden: !["live", "paused", "ended"].includes(a.status) },
                  { label: "Duplicate", onSelect: () => void duplicate(a) },
                  { label: "Delete", onSelect: () => void remove(a), danger: true, hidden: !canDelete(a.status) },
                ]}
              />
            </div>
          </div>
        ))}
      </div>
      </section>

      {cohosted.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-title px-1">Co-hosting</h2>
          <div className="group-list">
            {cohosted.map((a) => (
              <div key={a.id} className="group-row flex-wrap gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <AuctionBadge status={a.status} />
                    <span className="chip bg-sky-100 text-sky-800">Co-host</span>
                  </div>
                  <p className="mt-1 font-semibold">{a.title}</p>
                  <p className="text-xs text-stone-500">Starts {dateTime(a.starts_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/host/a/${a.id}`} className="btn-ghost">
                    Manage
                  </Link>
                  <Link to={`/a/${a.id}`} className="btn-primary">
                    Open room
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <WebhooksPanel />
    </div>
  );
}
