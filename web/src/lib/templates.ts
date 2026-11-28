import { DEFAULT_INCREMENTS } from "./bidding";
import { LEAGUE_DEFAULTS, LEAGUE_INCREMENTS } from "./useLeagueTeams";
import type { SaleType } from "./saleTypes";
import type { AuctionSettings } from "./types";

export type TemplateKey = "timed" | "rolling" | "simple" | "offers" | "sealed" | "league";

/**
 * Ready-made auction formats. Each is only a starting point: every setting
 * stays editable afterwards in the editor, so picking one never limits what
 * the host can do.
 */
export interface AuctionTemplate {
  key: TemplateKey;
  title: string;
  /** One line on what bidders experience. */
  blurb: string;
  /** Who it suits. */
  bestFor: string;
  mode: "standard" | "league";
  /** Sale type new lots start with (each lot can still change it). */
  saleType: SaleType;
  /** Offer "how long should bidding run" in the setup form. */
  asksDuration: boolean;
  settings: AuctionSettings;
}

const chat = (slow: number) => ({ enabled: true, slow_mode_s: slow });

export const TEMPLATES: AuctionTemplate[] = [
  {
    key: "timed",
    title: "Timed online auction",
    blurb: "Every lot opens together and closes at the end. Late bids add time.",
    bestFor: "Selling online over hours or days",
    mode: "standard",
    saleType: "english",
    asksDuration: true,
    settings: { currency: "INR", anti_snipe_seconds: 120, lot_duration_minutes: 1440, lot_stagger_seconds: 0, chat: chat(2) },
  },
  {
    key: "rolling",
    title: "Live, lot by lot",
    blurb: "Lots close one after another, a minute apart. Pairs well with a live stream.",
    bestFor: "Live shows and events",
    mode: "standard",
    saleType: "english",
    asksDuration: true,
    settings: { currency: "INR", anti_snipe_seconds: 20, lot_duration_minutes: 5, lot_stagger_seconds: 60, chat: chat(2) },
  },
  {
    key: "simple",
    title: "Simple one-tap bidding",
    blurb: "Bidders get one button that bids the next step. No typing, no auto-bid.",
    bestFor: "Charity, schools, first-time bidders",
    mode: "standard",
    saleType: "english",
    asksDuration: true,
    settings: { currency: "INR", anti_snipe_seconds: 30, lot_duration_minutes: 60, lot_stagger_seconds: 0, custom_bids: false, chat: chat(2) },
  },
  {
    key: "offers",
    title: "Sell by offers",
    blurb: "Buyers send offers; you accept the one you like. Add a buy-now price if you want.",
    bestFor: "Second-hand items, one-off pieces",
    mode: "standard",
    saleType: "offer",
    asksDuration: true,
    settings: { currency: "INR", anti_snipe_seconds: 0, lot_duration_minutes: 4320, lot_stagger_seconds: 0, chat: chat(2), default_sale_type: "offer" },
  },
  {
    key: "sealed",
    title: "Sealed bids (tender)",
    blurb: "Bids stay hidden until the lot closes. The highest wins; ties go to the earlier bid.",
    bestFor: "Tenders, fair one-shot pricing",
    mode: "standard",
    saleType: "sealed",
    asksDuration: true,
    settings: { currency: "INR", anti_snipe_seconds: 0, lot_duration_minutes: 1440, lot_stagger_seconds: 0, chat: { enabled: false, slow_mode_s: 2 }, default_sale_type: "sealed" },
  },
  {
    key: "league",
    title: "Team league (IPL-style)",
    blurb: "Teams join with a virtual purse; players go under the hammer one at a time.",
    bestFor: "Fantasy drafts, clubs, office leagues",
    mode: "league",
    saleType: "english",
    asksDuration: false,
    settings: { currency: "INR", compact: true, increments: LEAGUE_INCREMENTS, league: LEAGUE_DEFAULTS, chat: chat(1) },
  },
];

export const templateByKey = (key: TemplateKey): AuctionTemplate => TEMPLATES.find((t) => t.key === key) ?? TEMPLATES[0]!;

/** Bidding lengths offered in setup and settings, in minutes. */
export const DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 1440, label: "1 day" },
  { minutes: 4320, label: "3 days" },
  { minutes: 10080, label: "7 days" },
];

/** Anti-snipe choices, in seconds. */
export const SNIPE_WINDOWS: { seconds: number; label: string }[] = [
  { seconds: 0, label: "Off" },
  { seconds: 15, label: "15s" },
  { seconds: 30, label: "30s" },
  { seconds: 60, label: "1 min" },
  { seconds: 120, label: "2 min" },
];

/** A lot duration in words: 90 -> "1 h 30 min", 2880 -> "2 days". */
export function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "-";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.round(minutes % 60);
  const parts = [days ? `${days} ${days === 1 ? "day" : "days"}` : "", hours ? `${hours} h` : "", mins ? `${mins} min` : ""].filter(Boolean);
  return parts.join(" ");
}

/** Increment tables a host can pick instead of typing one. */
export const INCREMENT_PRESETS: { key: string; label: string; table: [number, number][] }[] = [
  { key: "standard", label: "Standard steps", table: DEFAULT_INCREMENTS },
  { key: "league", label: "League steps (lakhs and crores)", table: LEAGUE_INCREMENTS },
  {
    key: "fine",
    label: "Small steps",
    table: [
      [0, 1],
      [100, 5],
      [1000, 10],
      [10000, 100],
    ],
  },
];

/** Settings for a new auction from a template, with the setup form's choices applied. */
export function settingsFor(template: AuctionTemplate, choice: { currency?: string; durationMinutes?: number }): AuctionSettings {
  const s: AuctionSettings = structuredClone(template.settings);
  if (choice.currency) s.currency = choice.currency;
  if (template.asksDuration && choice.durationMinutes && choice.durationMinutes > 0) s.lot_duration_minutes = Math.min(10080, Math.round(choice.durationMinutes));
  return s;
}
