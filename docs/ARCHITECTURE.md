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
