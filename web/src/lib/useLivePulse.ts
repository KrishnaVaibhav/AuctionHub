import { useEffect, useRef, useState } from "react";
import { diffLot, type PulseEvent } from "./fun";
import type { Lot } from "./types";

const KEEP_MS = 15 * 60_000;

/** Turns realtime lot row changes into a stream of room events (bids, extensions, sales). */
export function useLivePulse(lots: Lot[]): PulseEvent[] {
  const prev = useRef(new Map<string, Lot>());
  const [events, setEvents] = useState<PulseEvent[]>([]);

  useEffect(() => {
    const now = Date.now();
    const fresh: PulseEvent[] = [];
    for (const l of lots) fresh.push(...diffLot(prev.current.get(l.id), l, now));
    prev.current = new Map(lots.map((l) => [l.id, l]));
    if (fresh.length) setEvents((e) => [...e.filter((x) => now - x.at < KEEP_MS), ...fresh]);
  }, [lots]);

  return events;
}
