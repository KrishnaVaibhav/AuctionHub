import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

/** True when the signed-in user is a platform admin. The server enforces this on every admin call. */
export function useIsAdmin(): { isAdmin: boolean; checked: boolean } {
  const { session } = useAuth();
  const [state, setState] = useState({ isAdmin: false, checked: false });
  const uid = session?.user.id;

  useEffect(() => {
    if (!uid) {
      setState({ isAdmin: false, checked: true });
      return;
    }
    let cancelled = false;
    void supabase.rpc("is_platform_admin").then(({ data }) => {
      if (!cancelled) setState({ isAdmin: data === true, checked: true });
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  return state;
}

export function bytes(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (v < 1024) return `${v} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x < 10 ? 2 : 1)} ${units[i]}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
