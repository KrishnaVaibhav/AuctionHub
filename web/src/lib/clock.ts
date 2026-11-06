import { useEffect, useState } from "react";
import { supabase } from "./supabase";

// Offset between server and local clock, so countdowns follow the server.
let offsetMs = 0;
let synced: Promise<void> | null = null;

export function syncServerClock(): Promise<void> {
  synced ??= (async () => {
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.rpc("server_time");
      const t1 = Date.now();
      if (!error && typeof data === "string") {
        offsetMs = new Date(data).getTime() - (t0 + t1) / 2;
        return;
      }
    } catch {
      /* offline: fall through */
    }
    // Failed: keep the local clock for now and try again on the next call.
    synced = null;
  })();
  return synced;
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Re-renders every `intervalMs` and returns the current server time in ms. */
export function useServerNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    void syncServerClock().then(() => setNow(serverNow()));
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
