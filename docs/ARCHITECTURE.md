# AuctionHub architecture

## Stack (all free tier)

| Layer | Service | Notes |
|---|---|---|
| Frontend + edge | Cloudflare Workers (static assets) | `web/`, deployed by Cloudflare's GitHub integration |
| Keepalive cron | Same Worker, Cron Trigger | `web/worker/index.ts`, pings Supabase every 2 days |
| Database, auth, realtime, storage | Supabase (`ap-south-1`) | `supabase/`, migrations deployed by Supabase's GitHub integration |
| CI | GitHub Actions | `.github/workflows/ci.yml`: typecheck, unit tests, build, pgTAP DB tests |
| Live video | YouTube or Twitch embed | The host pastes a link |

```
push to main
  ├─ GitHub Actions  ci.yml (must pass for PR merge)
  ├─ Supabase        applies supabase/migrations
  └─ Cloudflare      npm run build && npx wrangler deploy   (root: web/)
```

## Business rules (enforced in Postgres)

All writes that move money or state go through `SECURITY DEFINER` functions
in `supabase/migrations/20261103000002_auction_logic.sql`. Clients have
column-level grants only, so they can never set prices, winners or status
directly.

- **Auction lifecycle:** `draft → scheduled → live ⇄ paused → ended`, or `cancelled`.
  The `auction-jobs` pg_cron job runs every 15s. It starts due auctions, closes due lots and ends finished auctions.
- **Lot lifecycle:** `pending → open → sold | unsold | withdrawn`.
- **`place_bid(lot, amount, max?)`:**
  - Locks the lot row (`FOR UPDATE`), so concurrent bids are serialized.
  - The minimum bid is the start price, or the current bid plus the increment from `settings.increments`.
  - **Proxy bids:** each bidder has a private ceiling. The leader's proxy defends up to its ceiling. On a tie, the earlier ceiling wins.
  - **Anti-sniping:** a bid inside `settings.anti_snipe_seconds` pushes `ends_at` to `now() + window`.
  - Rate limit: 5 manual bids per 10 seconds per lot.
  - Hosts cannot bid. Banned users cannot bid.
- **Reserve price:** stored in `lot_reserves`, which only the host can read. The public only sees `lots.reserve_met`.
- **Buy now:** available until the first bid. It closes the lot immediately.
- **Pause:** freezes bidding. Resume shifts every open lot's `ends_at` by the time spent paused.

## Privacy

- Public profile: display name, username and avatar only. New accounts get `user_<hash>` and `Bidder XXXX`; nothing is derived from email or the Google name.
- `contact_settings` (email share, phone, note) is readable only by its owner. `auction_results()` and `my_lots()` reveal contact details only when that person has `share_contact = true`, and only to the other side of a completed sale.
- `deal_messages`: a private chat between host and winner of a sold lot, readable only by those two (`is_deal_party()`).

## Visibility

`auctions.visibility` can be:
- `public`: listed on the home page.
- `unlisted`: only people with the link.
- `private`: only the host, moderators and `auction_members`.

People join a private auction through `join_private_auction(id, code)`. The invite code is stored in `auction_secrets`, which only the host can read through `get_invite_code()`.

`auction_visible()` is the single rule behind every read policy. Bids, chat and league teams also run a trigger guard for private auctions. `auction_preview()` returns just the title, cover and host, so the invite page can show something before joining.

## Deletion and retention (free-tier size)

- `delete_auction()` (host only) works on draft, ended or cancelled auctions. The client removes storage files first, and the database cascades everything else.
- `cleanup_stale_data()` runs daily from pg_cron at 03:17 UTC and removes:
  - pg_cron run logs older than 1 day (about 5,800 rows a day otherwise)
  - moderated chat older than 1 day
  - chat of auctions that ended over 30 days ago
  - proxy bids 7 days after a lot closes
  - for auctions that ended over 90 days ago, every bid except each lot's final bid
  - deal chats 180 days after the sale
  - cancelled auctions after 30 days, and empty drafts after 30 days
- Worker cron at 03:30 UTC: `storage_orphans()` (service role only) lists files that no row references. The Worker deletes them. This needs the `SUPABASE_SERVICE_ROLE_KEY` Worker secret; without it, this step is skipped.

## Team league mode (`auctions.mode = 'league'`)

An IPL-style auction game with virtual purses (no real money).

- Teams join through `join_league()` while the league is `scheduled`. There is one team per user, and each starts with `settings.league.purse`.
- When the league starts, lots ("players") go on the block **one at a time**.
  - `lot_seconds` sets the opening timer. Each bid resets the timer to at least `bid_seconds`. `break_seconds` adds a pause between players.
- `league_bid()` checks that:
  - the bidder owns a team,
  - the team isn't already the highest bidder,
  - the squad isn't full (`squad_max`),
  - the purse can cover the bid while keeping `min_base` back for each unfilled `squad_min` slot.
- When the timer expires, any client calls `league_tick()`. It is safe for anyone to call. It closes the player (the price comes out of the winning team's purse) and opens the next. pg_cron is a fallback.
- Host tools: close or skip the current player, `league_requeue_unsold()`, `set_lot_points()`. The leaderboard ranks teams by total points, then by purse left.

## Auction settings (`auctions.settings` jsonb)

```json
{
  "currency": "INR",
  "increments": [[0, 10], [1000, 50], [5000, 100]],
  "anti_snipe_seconds": 30,
  "lot_duration_minutes": 10,
  "lot_stagger_seconds": 0,
  "chat": { "enabled": true, "slow_mode_s": 2 }
}
```

Lots close at `auctions.ends_at` if it is set and in the future. Otherwise they close `lot_duration_minutes` after going live.
Each next lot closes `lot_stagger_seconds` later.

## Realtime

Clients subscribe to Postgres Changes on `auctions`, `lots` and `chat_messages`, filtered by auction.
Bid history is refetched whenever a lot's `bid_count` changes. Countdowns use the server clock (`server_time()` RPC).

## Media

Supabase Storage buckets: `lot-media/{auction_id}/{lot_id}/…`, `auction-branding/{auction_id}/…` and `avatars/{user_id}/…`.
All three are public-read. Writes are limited by path ownership.
Images are converted to WebP in the browser, because the free tier has no image transforms. All uploads go through
`web/src/lib/media.ts`, so moving to R2 or Cloudinary only changes that file.

## Free-tier limits to watch

- Supabase: 500 MB DB, 1 GB storage, about 5 GB egress per month, about 200 concurrent realtime connections. Projects pause after 7 idle days, which the Worker cron prevents.
- Supabase built-in email sends only a few emails per hour. Add custom SMTP (for example, Resend free) before launch.
- Cloudflare Workers: 100k requests per day. Static asset requests are free and unlimited.
