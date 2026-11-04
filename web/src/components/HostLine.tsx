import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase } from "../lib/supabase";
import { categoryLabel } from "../lib/categories";
import { CategoryIcon } from "./CategoryIcon";
import { Avatar } from "./Avatar";
import { FollowButton } from "./FollowButton";

/** "Hosted by <name>" with a link to the host's public profile and a follow button. */
export function HostLine({ hostId, category }: { hostId: string; category: string | null }) {
  const [host, setHost] = useState<{ username: string; display_name: string; avatar_url: string | null } | null>(null);

  useEffect(() => {
    void supabase
      .from("profiles")
      .select("username, display_name, avatar_url")
      .eq("id", hostId)
      .maybeSingle()
      .then(({ data }) => setHost(data));
  }, [hostId]);

  if (!host) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <Link to={`/u/${host.username}`} className="flex items-center gap-2 hover:underline">
        <Avatar name={host.display_name} url={host.avatar_url} size={24} />
        <span>
          Hosted by <strong>{host.display_name}</strong>
        </span>
      </Link>
      <FollowButton hostId={hostId} />
      {category && (
        <span className="chip bg-stone-100 text-stone-700">
          <CategoryIcon name={category} className="h-3.5 w-3.5" /> {categoryLabel(category)}
        </span>
      )}
    </div>
  );
}
