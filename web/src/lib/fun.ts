import type { AuctionSettings, Lot } from "./types";

// ---------------------------------------------------------------------------
// Room features the host switches on and off (settings.fun). Default: on.
// ---------------------------------------------------------------------------
export const FEATURES = [
  { key: "reactions", label: "Live reactions", hint: "Viewers tap emoji that float across the room" },
  { key: "hype", label: "Hype meter and showdowns", hint: "The room glows when bids come fast" },
  { key: "celebrate", label: "Sold! celebration", hint: "Full-screen moment when a lot sells" },
  { key: "sounds", label: "Sounds and vibration", hint: "Ticks in the last seconds, a gavel on sold" },
  { key: "guesses", label: "Guess the price", hint: "Viewers guess before bidding starts" },
  { key: "pickem", label: "Pick'em (leagues)", hint: "Viewers pick which team buys each player" },
  { key: "bingo", label: "Bingo cards", hint: "Each viewer gets a card of room events" },
  { key: "parties", label: "Watch parties", hint: "Private group chats inside this auction" },
] as const;
export type FeatureKey = (typeof FEATURES)[number]["key"];

export function funOn(settings: AuctionSettings | undefined, key: FeatureKey): boolean {
  const v = (settings as { fun?: Record<string, boolean> } | undefined)?.fun?.[key];
  return v !== false;
}

// ---------------------------------------------------------------------------
// Levels: XP comes from watching, chatting, guessing and rating, never spending.
// ---------------------------------------------------------------------------
export const levelOf = (xp: number) => Math.floor(Math.sqrt(Math.max(xp, 0) / 50)) + 1;
export const xpForLevel = (level: number) => 50 * (level - 1) ** 2;
export function levelProgress(xp: number) {
  const level = levelOf(xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, from, to, pct: Math.min(100, ((xp - from) / (to - from)) * 100) };
}

export const CHAT_COLORS = {
  amber: "text-amber-600",
  emerald: "text-emerald-600",
  sky: "text-sky-600",
  violet: "text-violet-600",
  rose: "text-rose-600",
} as const;
export const FRAMES = {
  silver: { level: 5, ring: "ring-2 ring-stone-300" },
  gold: { level: 10, ring: "ring-2 ring-brand-400" },
  aurora: { level: 15, ring: "ring-2 ring-offset-1 ring-rose-400" },
} as const;

// ---------------------------------------------------------------------------
// Badges (awarded by the database; labels live here)
// ---------------------------------------------------------------------------
export const BADGES: Record<string, { label: string; desc: string; tone: string }> = {
  first_win: { label: "First win", desc: "Won your first lot", tone: "bg-brand-100 text-brand-700" },
  collector: { label: "Collector", desc: "Won 10 lots", tone: "bg-violet-100 text-violet-800" },
  sniper: { label: "Sniper", desc: "Won with a bid in the final seconds", tone: "bg-red-100 text-red-700" },
  bargain: { label: "Bargain hunter", desc: "Won at the opening price", tone: "bg-emerald-100 text-emerald-800" },
  night_owl: { label: "Night owl", desc: "Bid between midnight and 4 a.m.", tone: "bg-sky-100 text-sky-800" },
  bullseye: { label: "Bullseye", desc: "Guessed a price within 2%", tone: "bg-amber-100 text-amber-800" },
  bingo: { label: "Bingo!", desc: "Completed a bingo line", tone: "bg-rose-200 text-stone-900" },
  seller: { label: "Seller", desc: "Sold 10 lots as a host", tone: "bg-stone-200 text-stone-800" },
  top_seller: { label: "Top seller", desc: "Sold 100 lots as a host", tone: "bg-brand-400 text-ink" },
  recruiter: { label: "Recruiter", desc: "A friend you invited won their first lot", tone: "bg-emerald-100 text-emerald-800" },
  welcome: { label: "Welcome", desc: "Joined through a friend and won", tone: "bg-sky-100 text-sky-800" },
};
export function badgeInfo(badge: string, events?: Map<string, string>) {
  if (badge.startsWith("event:")) {
    const title = events?.get(badge.slice(6)) ?? "Event";
    return { label: title, desc: `Won during ${title}`, tone: "bg-violet-100 text-violet-800" };
  }
  return BADGES[badge] ?? { label: badge.replace(/_/g, " "), desc: "", tone: "bg-stone-200 text-stone-800" };
}

// ---------------------------------------------------------------------------
// Live pulse: derived from lot row updates (no extra tables).
// ---------------------------------------------------------------------------
export interface PulseEvent {
  lotId: string;
  at: number;
  kind: "bid" | "extend" | "sold" | "unsold";
  winner?: string | null;
  amount?: number | null;
}

/** Bids per minute over the last minute, mapped to 0..1 (8+ bids/min is full). */
export function hypeLevel(events: PulseEvent[], now: number, lotId?: string) {
  const recent = events.filter((e) => e.kind === "bid" && now - e.at < 60_000 && (!lotId || e.lotId === lotId)).length;
  return Math.min(1, recent / 8);
}

/** Two bidders trading the lead: returns their ids once they've swapped 3+ times in a row. */
export function showdown(events: PulseEvent[], lotId: string): [string, string] | null {
  const leaders = events.filter((e) => e.kind === "bid" && e.lotId === lotId && e.winner).map((e) => e.winner!) as string[];
  // Collapse repeats (auto-bids can re-confirm the same leader).
  const seq = leaders.filter((w, i) => w !== leaders[i - 1]);
  if (seq.length < 4) return null;
  const tail = seq.slice(-4);
  const [a, b] = [tail[0], tail[1]];
  return a !== b && tail.every((w, i) => w === (i % 2 === 0 ? a : b)) ? [a, b] : null;
}

/** Compares old and new lot rows and returns what happened. */
export function diffLot(prev: Lot | undefined, next: Lot, now: number): PulseEvent[] {
  if (!prev) return [];
  const out: PulseEvent[] = [];
  if (next.bid_count > prev.bid_count || (next.current_bid ?? 0) > (prev.current_bid ?? 0)) {
    out.push({ lotId: next.id, at: now, kind: "bid", winner: next.current_winner_id ?? next.winner_team_id, amount: next.current_bid });
  }
  if (prev.status === "open" && next.status === "open" && prev.ends_at && next.ends_at && new Date(next.ends_at) > new Date(prev.ends_at)) {
    out.push({ lotId: next.id, at: now, kind: "extend" });
  }
  if (prev.status !== next.status && (next.status === "sold" || next.status === "unsold")) {
    out.push({ lotId: next.id, at: now, kind: next.status, winner: next.current_winner_id ?? next.winner_team_id, amount: next.current_bid });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bingo
// ---------------------------------------------------------------------------
export const BINGO_EVENTS: { key: string; label: string }[] = [
  { key: "double", label: "A lot sells for 2x its start" },
  { key: "triple", label: "A lot sells for 3x its start" },
  { key: "showdown", label: "A showdown breaks out" },
  { key: "extend", label: "Anti-snipe adds time" },
  { key: "unsold", label: "A lot goes unsold" },
  { key: "ten_bids", label: "10+ bids on one lot" },
  { key: "opening", label: "A lot sells at its opening price" },
  { key: "fast", label: "5 bids inside a minute" },
  { key: "buy_now", label: "Someone uses buy now" },
  { key: "five_sold", label: "5 lots sold" },
  { key: "big_jump", label: "A bid jumps 50% at once" },
  { key: "first_bid", label: "The first bid of the night" },
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Nine events for this viewer and auction, the same on every visit. */
export function bingoCard(seed: string): string[] {
  const keys = BINGO_EVENTS.map((e) => e.key);
  let h = hash(seed);
  for (let i = keys.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, 9);
}

/** Which bingo events have happened, from the lots and the live pulse. */
export function bingoHits(lots: Lot[], events: PulseEvent[]): Set<string> {
  const hit = new Set<string>();
  const sold = lots.filter((l) => l.status === "sold");
  for (const l of sold) {
    const ratio = Number(l.current_bid ?? 0) / Math.max(Number(l.start_price), 1);
    if (Number(l.start_price) > 0 && ratio >= 2) hit.add("double");
    if (Number(l.start_price) > 0 && ratio >= 3) hit.add("triple");
    if (Number(l.current_bid) === Number(l.start_price)) hit.add("opening");
    if (l.buy_now_price != null && Number(l.current_bid) >= Number(l.buy_now_price)) hit.add("buy_now");
  }
  if (sold.length >= 5) hit.add("five_sold");
  if (lots.some((l) => l.status === "unsold")) hit.add("unsold");
  if (lots.some((l) => l.bid_count >= 10)) hit.add("ten_bids");
  if (lots.some((l) => l.bid_count > 0)) hit.add("first_bid");
  if (events.some((e) => e.kind === "extend")) hit.add("extend");
  const bids = events.filter((e) => e.kind === "bid");
  if (bids.some((b) => bids.filter((x) => x.at <= b.at && b.at - x.at < 60_000).length >= 5)) hit.add("fast");
  const lotIds = new Set(bids.map((b) => b.lotId));
  for (const id of lotIds) {
    if (showdown(events, id)) hit.add("showdown");
    const amounts = bids.filter((b) => b.lotId === id && b.amount != null).map((b) => Number(b.amount));
    if (amounts.some((a, i) => i > 0 && a >= amounts[i - 1] * 1.5)) hit.add("big_jump");
  }
  return hit;
}

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
export function bingoLine(card: string[], hits: Set<string>): number[] | null {
  return LINES.find((line) => line.every((i) => hits.has(card[i]))) ?? null;
}

// ---------------------------------------------------------------------------
// Sounds (synthesised, no files) and haptics. Only after the user has interacted.
// ---------------------------------------------------------------------------
let ctx: AudioContext | null = null;
function audio() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext();
  return ctx;
}
function tone(freq: number, ms: number, type: OscillatorType = "sine", gain = 0.06, delay = 0) {
  const a = audio();
  if (!a || a.state === "suspended") return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = a.currentTime + delay / 1000;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + ms / 1000);
}
export const sounds = {
  unlock: () => void audio()?.resume(),
  tick: () => tone(880, 60, "square", 0.025),
  bid: () => tone(660, 90, "triangle", 0.05),
  gavel: () => {
    tone(140, 180, "square", 0.09);
    tone(110, 260, "square", 0.07, 160);
  },
  fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 220, "triangle", 0.05, i * 110)),
};
export function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(pattern);
}
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
