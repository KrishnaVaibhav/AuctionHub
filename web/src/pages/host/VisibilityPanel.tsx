import { useEffect, useState } from "react";
import { supabase, errorMessage } from "../../lib/supabase";
import { useProfileNames } from "../../lib/profiles";
import type { Auction } from "../../lib/types";
import { confirmDialog } from "../../lib/confirm";

const OPTIONS: { key: Auction["visibility"]; title: string; desc: string }[] = [
  { key: "public", title: "Public", desc: "Listed on the home page. Anyone can join." },
  { key: "unlisted", title: "Unlisted", desc: "Hidden from listings. Anyone with the link can join." },
  { key: "private", title: "Private", desc: "Invite only. People need your invite link or code." },
];

export function VisibilityPanel({ auction, onChanged }: { auction: Auction; onChanged: () => Promise<void> }) {
  const [code, setCode] = useState<string | null>(null);
  const [members, setMembers] = useState<{ user_id: string; joined_at: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const names = useProfileNames(members.map((m) => m.user_id));
  const isPrivate = auction.visibility === "private";

  useEffect(() => {
    if (!isPrivate) return;
    void supabase.rpc("get_invite_code", { p_auction_id: auction.id }).then(({ data, error }) => {
      if (error) setError(errorMessage(error));
      else setCode(data as string);
    });
    void loadMembers();
  }, [isPrivate, auction.id]);

  async function loadMembers() {
    const { data } = await supabase.from("auction_members").select("user_id, joined_at").eq("auction_id", auction.id).order("joined_at");
    setMembers(data ?? []);
  }

  async function choose(v: Auction["visibility"]) {
    if (v === auction.visibility) return;
    setError(null);
    const { error } = await supabase.from("auctions").update({ visibility: v }).eq("id", auction.id);
    if (error) setError(errorMessage(error));
    else await onChanged();
  }

  async function regenerate() {
    if (!(await confirmDialog({ title: "Make a new invite code?", body: "The old link stops working for new people. Existing members stay.", confirmLabel: "New code" }))) return;
    const { data, error } = await supabase.rpc("get_invite_code", { p_auction_id: auction.id, p_regenerate: true });
    if (error) setError(errorMessage(error));
    else setCode(data as string);
  }

  async function removeMember(userId: string) {
    const { error } = await supabase.from("auction_members").delete().eq("auction_id", auction.id).eq("user_id", userId);
    if (error) setError(errorMessage(error));
    else await loadMembers();
  }

  const link = code ? `${window.location.origin}/a/${auction.id}?code=${code}` : "";

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="section-title">Who can see this auction</h2>
        <p className="text-sm text-stone-500">You can change this at any time.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => void choose(o.key)}
            aria-pressed={auction.visibility === o.key}
            className={`choice ${auction.visibility === o.key ? "choice-on" : ""}`}
          >
            <span className="block text-sm font-semibold">{o.title}</span>
            <span className="block text-xs text-stone-500">{o.desc}</span>
          </button>
        ))}
      </div>

      {auction.visibility === "unlisted" && (
        <p className="rounded-2xl bg-stone-900/[0.04] px-3.5 py-2.5 text-sm">
          Share this link: <span className="font-mono text-xs break-all">{`${window.location.origin}/a/${auction.id}`}</span>
        </p>
      )}

      {isPrivate && code && (
        <div className="space-y-3 rounded-2xl bg-stone-900/[0.04] p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="label">Invite code</p>
              <p className="font-mono text-2xl font-bold tracking-widest">{code}</p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <button
                className="btn-primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied!" : "Copy invite link"}
              </button>
              <a
                className="btn border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
                href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(`You're invited to "${auction.title}"`)}`}
                target="_blank"
                rel="noreferrer"
              >
                Telegram
              </a>
              <button className="btn-ghost" onClick={() => void regenerate()}>
                New code
              </button>
            </div>
          </div>
          <div>
            <p className="label">Members ({members.length})</p>
            {members.length === 0 ? (
              <p className="text-sm text-stone-500">Nobody has joined yet.</p>
            ) : (
              <ul className="divide-y divide-stone-900/[0.06] text-sm">
                {members.map((m) => (
                  <li key={m.user_id} className="flex items-center justify-between py-1.5">
                    <span>{names.get(m.user_id) ?? "..."}</span>
                    <button className="text-xs text-stone-500 hover:text-red-600" onClick={() => void removeMember(m.user_id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
