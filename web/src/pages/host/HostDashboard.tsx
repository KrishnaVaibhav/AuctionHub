import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "../../lib/auth";
import { supabase, errorMessage } from "../../lib/supabase";
import { dateTime } from "../../lib/format";
import type { Auction } from "../../lib/types";
import { AuctionBadge } from "../../components/StatusBadge";
import { LEAGUE_DEFAULTS, LEAGUE_INCREMENTS } from "../../lib/useLeagueTeams";
import { canDelete, deleteAuctionCompletely, visibilityLabel } from "../../lib/auctions";

type Row = Auction & { lots: { count: number }[] };

export function HostDashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
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
  }, [userId]);

  async function remove(a: Row) {
    if (!window.confirm(`Permanently delete "${a.title}" with all its lots, bids, chat and files? This cannot be undone.`)) return;
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
      <div>
        <h1 className="text-2xl font-bold">Host dashboard</h1>
        <p className="text-sm text-stone-500">Create auctions, add lots and media, then go live.</p>
      </div>

      <form onSubmit={create} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
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
        <button className="btn-primary" disabled={busy}>
          Create
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card divide-y divide-stone-100">
        {rows.length === 0 && <p className="p-5 text-sm text-stone-500">No auctions yet.</p>}
        {rows.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-4 p-4">
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
            {["live", "paused", "ended"].includes(a.status) && (
              <Link to={`/a/${a.id}?tab=results`} className="btn-ghost">
                Results
              </Link>
            )}
            <Link to={`/host/a/${a.id}`} className="btn-ghost">
              Edit
            </Link>
            <Link to={`/a/${a.id}`} className="btn-primary">
              Open room
            </Link>
            {canDelete(a.status) && (
              <button className="btn-ghost text-red-600" onClick={() => void remove(a)} aria-label={`Delete ${a.title}`}>
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
