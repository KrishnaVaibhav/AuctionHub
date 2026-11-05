import type { SaleType } from "./saleTypes";
export type AuctionStatus = "draft" | "scheduled" | "live" | "paused" | "ended" | "cancelled";
export type LotStatus = "pending" | "open" | "sold" | "unsold" | "withdrawn";
export type ChatKind = "text" | "bid" | "system";

export interface LeagueSettings {
  purse?: number;
  squad_min?: number;
  squad_max?: number;
  max_teams?: number;
  lot_seconds?: number;
  bid_seconds?: number;
  break_seconds?: number;
  min_base?: number;
  host_can_play?: boolean;
  retain_max?: number;
  rtm_cards?: number;
  rtm_seconds?: number;
  category_max?: Record<string, number>;
  trades?: boolean;
  season?: number;
  scoring?: Record<string, number>;
  trade_deadline?: string;
  captain_x?: number;
  vice_x?: number;
}

export interface AuctionSettings {
  currency?: string;
  compact?: boolean;
  league?: LeagueSettings;
  increments?: [number, number][];
  anti_snipe_seconds?: number;
  lot_duration_minutes?: number;
  lot_stagger_seconds?: number;
  chat?: { enabled?: boolean; slow_mode_s?: number; allow_links?: boolean };
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  banned_until: string | null;
}

export interface Auction {
  id: string;
  host_id: string;
  title: string;
  description: string;
  status: AuctionStatus;
  mode: "standard" | "league";
  visibility: "public" | "unlisted" | "private";
  category: string | null;
  tags: string[];
  starts_at: string | null;
  ends_at: string | null;
  paused_at: string | null;
  settings: AuctionSettings;
  cover_url: string | null;
  stream_url: string | null;
  announcement?: string | null;
  spotlight_lot_id?: string | null;
  series_id?: string | null;
  created_at: string;
}

export interface Lot {
  id: string;
  auction_id: string;
  position: number;
  title: string;
  description: string;
  start_price: number;
  buy_now_price: number | null;
  custom_fields: Record<string, string>;
  status: LotStatus;
  current_bid: number | null;
  current_winner_id: string | null;
  bid_count: number;
  reserve_met: boolean;
  opens_at: string | null;
  ends_at: string | null;
  winner_team_id: string | null;
  points: number | null;
  sale_type: SaleType;
  sale_settings: Record<string, unknown>;
  rtm_team_id: string | null;
  rtm_offered: boolean;
  retained: boolean;
}

export interface LotMedia {
  id: string;
  lot_id: string;
  path: string;
  kind: "image" | "video";
  position: number;
}

export interface Bid {
  id: number;
  lot_id: string;
  bidder_id: string;
  amount: number;
  is_auto: boolean;
  team_id?: string | null;
  created_at: string;
}

export interface LeagueTeam {
  id: string;
  auction_id: string;
  owner_id: string;
  name: string;
  short_name: string;
  color: string;
  purse_left: number;
  rtm_used: number;
  franchise_id?: string | null;
  captain_lot_id?: string | null;
  vice_lot_id?: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  auction_id: string;
  user_id: string | null;
  kind: ChatKind;
  body: string;
  pinned: boolean;
  deleted_at: string | null;
  created_at: string;
}

export interface BidResult {
  status: "leading" | "outbid" | "max_raised" | "sold";
  current_bid: number;
  winner_id: string;
  ends_at?: string;
  min_next_bid?: number;
  max_amount?: number;
}
