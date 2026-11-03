import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

/** Follow a host to get notified when their public auctions go live. */
export function FollowButton({ hostId, onChange }: { hostId: string; onChange?: (following: boolean) => void }) {
  const { session } = useAuth();
  const me = session?.user.id;
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me || me === hostId) return;
    void supabase
      .from("follows")
      .select("host_id")
      .eq("follower_id", me)
      .eq("host_id", hostId)
      .maybeSingle()
      .then(({ data }) => setFollowing(Boolean(data)));
  }, [me, hostId]);

  if (me === hostId) return null;
  if (!me) {
    return (
      <Link to={`/login?next=${encodeURIComponent(window.location.pathname)}`} className="btn-ghost py-1.5">
        Follow
      </Link>
    );
  }

  async function toggle() {
    setBusy(true);
    const next = !following;
    const { error } = next
      ? await supabase.from("follows").insert({ follower_id: me, host_id: hostId })
      : await supabase.from("follows").delete().eq("follower_id", me).eq("host_id", hostId);
    setBusy(false);
    if (!error) {
      setFollowing(next);
      onChange?.(next);
    }
  }

  return (
    <button className={following ? "btn-ghost py-1.5" : "btn-primary py-1.5"} disabled={busy} onClick={() => void toggle()} aria-pressed={following}>
      {following ? "Following" : "Follow"}
    </button>
  );
}
