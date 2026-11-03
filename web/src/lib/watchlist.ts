import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Whether the user watches a lot, and a toggle. */
export function useWatch(lotId: string, userId: string | null): [boolean, () => Promise<void>] {
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    if (!userId) {
      setWatching(false);
      return;
    }
    let cancelled = false;
    void supabase
      .from("watchlist")
      .select("lot_id")
      .eq("user_id", userId)
      .eq("lot_id", lotId)
      .maybeSingle()
      .then(({ data }) => !cancelled && setWatching(Boolean(data)));
    return () => {
      cancelled = true;
    };
  }, [lotId, userId]);

  const toggle = async () => {
    if (!userId) return;
    const next = !watching;
    setWatching(next);
    const { error } = next
      ? await supabase.from("watchlist").insert({ user_id: userId, lot_id: lotId })
      : await supabase.from("watchlist").delete().eq("user_id", userId).eq("lot_id", lotId);
    if (error) setWatching(!next);
  };

  return [watching, toggle];
}
