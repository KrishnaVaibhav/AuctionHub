import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface ProfileMeta {
  id: string;
  xp: number;
  chat_color: string | null;
  frame: string | null;
}

const cache = new Map<string, ProfileMeta>();

/** XP and cosmetics for a set of users (for chat names and avatars). Cached per session. */
export function useProfileMeta(ids: (string | null | undefined)[]): Map<string, ProfileMeta> {
  const key = [...new Set(ids.filter(Boolean) as string[])].sort().join(",");
  const [map, setMap] = useState<Map<string, ProfileMeta>>(() => new Map([...cache].filter(([id]) => key.includes(id))));
  useEffect(() => {
    const want = key ? key.split(",") : [];
    const missing = want.filter((id) => !cache.has(id));
    const publish = () => setMap(new Map(want.flatMap((id) => (cache.has(id) ? [[id, cache.get(id)!] as const] : []))));
    if (missing.length === 0) return publish();
    void supabase
      .from("profiles")
      .select("id, xp, chat_color, frame")
      .in("id", missing.slice(0, 200))
      .then(({ data }) => {
        for (const row of (data as ProfileMeta[] | null) ?? []) cache.set(row.id, row);
        publish();
      });
  }, [key]);
  return map;
}

export interface Badge {
  user_id: string;
  badge: string;
  ref: string | null;
  awarded_at: string;
}

export function useBadges(userId: string | null | undefined) {
  const [badges, setBadges] = useState<Badge[]>([]);
  useEffect(() => {
    if (!userId) return;
    void supabase
      .from("user_badges")
      .select("*")
      .eq("user_id", userId)
      .order("awarded_at", { ascending: false })
      .then(({ data }) => setBadges((data as Badge[] | null) ?? []));
  }, [userId]);
  return badges;
}

/** Titles of themed events, for naming event badges. */
export function useEventTitles() {
  const [map, setMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    void supabase
      .from("site_events")
      .select("id, title")
      .then(({ data }) => setMap(new Map(((data as { id: string; title: string }[] | null) ?? []).map((e) => [e.id, e.title]))));
  }, []);
  return map;
}
