import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Display-name cache so realtime rows (which carry no joins) can still show names.
const names = new Map<string, string>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

async function load(ids: string[]) {
  const missing = ids.filter((id) => !names.has(id) && !pending.has(id));
  if (missing.length === 0) return;
  missing.forEach((id) => pending.add(id));
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", missing);
  for (const p of data ?? []) names.set(p.id, p.display_name);
  missing.forEach((id) => pending.delete(id));
  listeners.forEach((fn) => fn());
}

export function useProfileNames(ids: (string | null | undefined)[]): Map<string, string> {
  const [, bump] = useState(0);
  const key = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort().join(",");
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    if (key) void load(key.split(","));
    return () => {
      listeners.delete(fn);
    };
  }, [key]);
  return names;
}
