import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";

// Offset between server and local clock, so countdowns follow the server.
let offsetMs = 0;
// The measurement with the quickest round trip pins the offset best (its error is at most half the trip).
let bestRtt = Number.POSITIVE_INFINITY;
let bestAt = 0;
let lastAt = 0;
let inflight: Promise<void> | null = null;

const MIN_GAP_MS = 60_000;
const STALE_MS = 3_600_000;

/**
 * Measures the server clock. The first call measures; later calls measure
 * again at most once a minute and keep the new offset only if its round trip
 * was quicker (or the kept one is an hour old). So an offset taken while the
 * page was still downloading, on a slow first request, gets corrected.
 */
export function syncServerClock(): Promise<void> {
  if (inflight) return inflight;
  if (lastAt && Date.now() - lastAt < MIN_GAP_MS) return Promise.resolve();
  inflight = (async () => {
    try {
      const sentAt = Date.now();
      const t0 = performance.now();
      const { data, error } = await supabase.rpc("server_time");
      const rtt = performance.now() - t0;
      if (!error && typeof data === "string") {
        lastAt = Date.now();
        if (rtt <= bestRtt || lastAt - bestAt > STALE_MS) {
          offsetMs = new Date(data).getTime() - (sentAt + rtt / 2);
          bestRtt = rtt;
          bestAt = lastAt;
        }
      }
    } catch {
      /* offline: keep the current offset and try again on the next call */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// After the phone sleeps or the tab sat in the background, check the clock again.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncServerClock();
  });
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

// One shared 4 Hz beat drives every countdown on the page, instead of a timer each.
const beat = new Set<() => void>();
let beatTimer = 0;
function onBeat(listener: () => void): () => void {
  beat.add(listener);
  if (!beatTimer) beatTimer = window.setInterval(() => beat.forEach((fn) => fn()), 250);
  return () => {
    beat.delete(listener);
    if (!beat.size) {
      clearInterval(beatTimer);
      beatTimer = 0;
    }
  };
}

/**
 * Seconds left until `endsAt` on the server clock, rounded up: 1 during the
 * last second, 0 or less once it has passed, null without an end. The
 * component re-renders only when this number changes (once a second), not
 * on every beat.
 */
export function useSecondsLeft(endsAt: string | null | undefined): number | null {
  const end = endsAt ? new Date(endsAt).getTime() : null;
  const read = useCallback(() => (end == null ? null : Math.ceil((end - serverNow()) / 1000)), [end]);
  useEffect(() => {
    void syncServerClock();
  }, []);
  return useSyncExternalStore(onBeat, read, read);
}
