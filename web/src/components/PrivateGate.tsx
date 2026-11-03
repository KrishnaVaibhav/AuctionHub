import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { supabase, errorMessage } from "../lib/supabase";
import { useAuth } from "../lib/auth";

interface Preview {
  id: string;
  title: string;
  cover_url: string | null;
  visibility: string;
  status: string;
  host_name: string;
  can_view: boolean;
}

/** Shown when an auction isn't readable: either it doesn't exist, or it's private and needs an invite code. */
export function PrivateGate({ auctionId, onJoined }: { auctionId: string; onJoined: () => Promise<void> }) {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [code, setCode] = useState(params.get("code") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  useEffect(() => {
    void supabase.rpc("auction_preview", { p_auction_id: auctionId }).then(({ data }) => setPreview(((data as Preview[] | null) ?? [])[0] ?? null));
  }, [auctionId, session?.user.id]);

  async function join(value: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("join_private_auction", { p_auction_id: auctionId, p_code: value });
    setBusy(false);
    if (error) setError(errorMessage(error));
    else await onJoined();
  }

  // Invite links carry ?code=...: join automatically once signed in.
  useEffect(() => {
    const fromLink = params.get("code");
    if (session && fromLink && preview && !preview.can_view && !autoTried.current) {
      autoTried.current = true;
      void join(fromLink);
    }
  }, [session, preview]);

  if (preview === undefined) return <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />;
  if (preview === null) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <p className="font-display text-xl font-bold">Auction not found</p>
        <p className="mt-1 text-sm text-stone-500">It may have been deleted, or the link is wrong.</p>
        <Link to="/" className="btn-primary mt-5">
          Browse auctions
        </Link>
      </div>
    );
  }

  const next = `/a/${auctionId}${params.get("code") ? `?code=${params.get("code")}` : ""}`;

  return (
    <div className="card mx-auto max-w-md overflow-hidden">
      {preview.cover_url && <img src={preview.cover_url} alt="" className="aspect-[16/9] w-full object-cover" />}
      <form
        className="space-y-4 p-6"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void join(code);
        }}
      >
        <span className="chip bg-stone-900 text-white">Private auction</span>
        <div>
          <h1 className="font-display text-2xl font-bold">{preview.title}</h1>
          <p className="text-sm text-stone-500">Hosted by {preview.host_name}</p>
        </div>
        {!session ? (
          <>
            <p className="text-sm text-stone-600">Sign in to join with your invite.</p>
            <Link to={`/login?next=${encodeURIComponent(next)}`} className="btn-primary w-full">
              Sign in to join
            </Link>
          </>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="code">
                Invite code
              </label>
              <input
                id="code"
                className="input font-mono tracking-widest uppercase"
                required
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABCD1234"
              />
            </div>
            <button className="btn-accent w-full" disabled={busy}>
              {busy ? "Joining..." : "Join auction"}
            </button>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
