import { useEffect, useState, type FormEvent } from "react";
import { supabase, errorMessage } from "../../lib/supabase";
import { useProfileNames } from "../../lib/profiles";
import type { Auction } from "../../lib/types";
import type { StaffRow } from "../../lib/useAuctionRoom";

/**
 * Owner adds people by username. Everyone added moderates chat and sees the
 * auction when it's private; switches make them co-hosts who can edit lots
 * and/or run the auction. Co-hosts can't bid in it.
 */
export function ModeratorsPanel({ auction, onChanged }: { auction: Auction; onChanged?: () => Promise<void> }) {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = useProfileNames(rows.map((r) => r.user_id));

  async function load() {
    const { data } = await supabase.from("auction_moderators").select("user_id, can_edit, can_run").eq("auction_id", auction.id);
    setRows((data as StaffRow[] | null) ?? []);
  }

  useEffect(() => {
    void load();
  }, [auction.id]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("add_moderator", { p_auction_id: auction.id, p_username: username });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else {
      setUsername("");
      await load();
    }
  }

  async function setPerm(userId: string, field: "can_edit" | "can_run", value: boolean) {
    setError(null);
    setRows((prev) => prev.map((r) => (r.user_id === userId ? { ...r, [field]: value } : r)));
    const { error } = await supabase.from("auction_moderators").update({ [field]: value }).eq("auction_id", auction.id).eq("user_id", userId);
    if (error) {
      setError(errorMessage(error));
      await load();
    } else await onChanged?.();
  }

  async function remove(userId: string) {
    const { error } = await supabase.from("auction_moderators").delete().eq("auction_id", auction.id).eq("user_id", userId);
    if (error) setError(errorMessage(error));
    else {
      await load();
      await onChanged?.();
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="section-title">Team</h2>
        <p className="text-sm text-stone-500">
          Everyone here moderates chat and can see the auction when it's private. Turn on <strong>Edit</strong> or <strong>Run</strong> to make
          them a co-host. Co-hosts can't bid in this auction.
        </p>
      </div>
      <form onSubmit={add} className="flex gap-2">
        <input className="input" placeholder="Username, e.g. user_ab12cd34ef56" required value={username} onChange={(e) => setUsername(e.target.value)} />
        <button className="btn-primary" disabled={busy}>
          Add
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">Nobody added yet.</p>
      ) : (
        <ul className="divide-y divide-stone-900/[0.06] text-sm">
          {rows.map((r) => {
            const name = names.get(r.user_id) ?? "...";
            return (
              <li key={r.user_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {name}
                  <span className="ml-2 text-xs font-normal text-stone-500">{r.can_edit || r.can_run ? "Co-host" : "Moderator"}</span>
                </span>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-600" title="Edit the auction, lots and photos">
                  Edit
                  <input type="checkbox" className="switch" checked={r.can_edit} onChange={(e) => void setPerm(r.user_id, "can_edit", e.target.checked)} aria-label={`${name} can edit`} />
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-stone-600" title="Go live, pause, close lots, answer offers">
                  Run
                  <input type="checkbox" className="switch" checked={r.can_run} onChange={(e) => void setPerm(r.user_id, "can_run", e.target.checked)} aria-label={`${name} can run the auction`} />
                </label>
                <button className="text-xs text-stone-500 hover:text-red-600" onClick={() => void remove(r.user_id)} aria-label={`Remove ${name}`}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-stone-500">
        <strong>Edit</strong>: auction details, lots and photos. <strong>Run</strong>: go live, pause, end, close lots, answer offers, run the
        league. Only you can delete, cancel or duplicate the auction or change this team. Usernames are on each person's Account page.
      </p>
    </section>
  );
}
