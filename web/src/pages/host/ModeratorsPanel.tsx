import { useEffect, useState, type FormEvent } from "react";
import { supabase, errorMessage } from "../../lib/supabase";
import { useProfileNames } from "../../lib/profiles";
import type { Auction } from "../../lib/types";

/** Host adds/removes moderators by username. Moderators can pin/delete/mute in chat and see private auctions. */
export function ModeratorsPanel({ auction }: { auction: Auction }) {
  const [ids, setIds] = useState<string[]>([]);
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const names = useProfileNames(ids);

  async function load() {
    const { data } = await supabase.from("auction_moderators").select("user_id").eq("auction_id", auction.id);
    setIds((data ?? []).map((r) => r.user_id as string));
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

  async function remove(userId: string) {
    const { error } = await supabase.from("auction_moderators").delete().eq("auction_id", auction.id).eq("user_id", userId);
    if (error) setError(errorMessage(error));
    else await load();
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Moderators</h2>
        <p className="text-sm text-stone-500">Moderators can pin, delete and mute in chat, and can see this auction even when it's private.</p>
      </div>
      <form onSubmit={add} className="flex gap-2">
        <input className="input" placeholder="Username, e.g. user_ab12cd34ef56" required value={username} onChange={(e) => setUsername(e.target.value)} />
        <button className="btn-primary" disabled={busy}>
          Add
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ids.length === 0 ? (
        <p className="text-sm text-stone-400">No moderators yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {ids.map((id) => (
            <li key={id} className="flex items-center justify-between py-1.5">
              <span>{names.get(id) ?? "..."}</span>
              <button className="text-xs text-stone-500 hover:text-red-600" onClick={() => void remove(id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stone-500">Usernames are shown on each person's Account page.</p>
    </section>
  );
}
