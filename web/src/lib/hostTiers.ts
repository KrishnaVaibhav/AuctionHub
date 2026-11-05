import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type Tier = "gold" | "silver" | "bronze";
export const TIER_STYLE: Record<Tier, { label: string; cls: string }> = {
  gold: { label: "Gold host", cls: "bg-brand-400 text-ink" },
  silver: { label: "Silver host", cls: "bg-stone-300 text-ink" },
  bronze: { label: "Bronze host", cls: "bg-orange-200 text-orange-900" },
};
export const tierRank = (t: Tier | null | undefined) => (t === "gold" ? 3 : t === "silver" ? 2 : t === "bronze" ? 1 : 0);

/** Host tiers (sales and ratings) for a set of hosts. */
export function useHostTiers(ids: string[]): Map<string, Tier> {
  const key = [...new Set(ids)].sort().join(",");
  const [map, setMap] = useState<Map<string, Tier>>(new Map());
  useEffect(() => {
    if (!key) return;
    void supabase.rpc("host_tiers", { p_ids: key.split(",") }).then(({ data }) => {
      const rows = (data as { host_id: string; tier: Tier | null }[] | null) ?? [];
      setMap(new Map(rows.filter((r) => r.tier).map((r) => [r.host_id, r.tier!])));
    });
  }, [key]);
  return map;
}
