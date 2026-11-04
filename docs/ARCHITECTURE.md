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

## Sale types (`lots.sale_type`)

Each lot picks one. The type locks once the lot opens, and league auctions always use `english`.

- `english` (default): ascending bids with proxy auto-bids and anti-snipe. `place_bid` and `buy_now` are thin wrappers that reject other types, then call the original engine (`_place_bid_english`, `_buy_now_core`).
- `dutch`: `sale_settings = {step, floor, interval_s}`. The price drops by `step` every `interval_s` seconds from `start_price` down to `floor`, and freezes while the auction is paused. `dutch_accept()` buys at the server's current price.
- `sealed`: `place_sealed_bid()` stores raise-only bids in `sealed_bids`. Only the bidder can read their own, not the host. The public sees only the bidder count. At close, every sealed bid is copied into `bids` and the highest wins (earliest on a tie). The reserve still applies.
- `offer`: `make_offer()` adds a row to `lot_offers` (one pending per bidder; `start_price` is the minimum offer). The host calls `respond_offer()` to accept, which sells the lot and declines the rest, or to decline. Buy now still works. Pending offers expire at close.

## Visibility

`auctions.visibility` can be:
- `public`: listed on the home page.
- `unlisted`: only people with the link.
- `private`: only the host, moderators and `auction_members`.

People join a private auction through `join_private_auction(id, code)`. The invite code is stored in `auction_secrets`, which only the host can read through `get_invite_code()`.

`auction_visible()` is the single rule behind every read policy. Bids, chat and league teams also run a trigger guard for private auctions. `auction_preview()` returns just the title, cover and host, so the invite page can show something before joining.

## Engagement, discovery and host tools

- **Notifications** (`notifications`) are created only by database triggers and cron:
  - outbid, won, sold or unsold (lot update trigger)
  - auction live: sent to followers, watchers, private members and league teams
  - deal-chat messages
  - watched lot closing within 5 minutes (cron every minute)

  Each notification is created once, read ones are removed after 30 days and all after 90. The bell receives them live, and shows system pop-ups while the app is open and permission is granted.
- **PWA:** `public/manifest.webmanifest` and `public/sw.js`. Pages are fetched from the network first with an offline fallback. Hashed assets are cached first. Supabase traffic is never cached.
- **Discovery:** `auctions.category` and `tags`, `follows`, and the `/u/:username` page backed by `public_profile()`. `ratings` are written only through `rate_trade()`: the buyer rates the seller and the host rates the buyer, once per sale and editable.
- **Host tools:**
  - CSV import is parsed in the browser (`lib/csv.ts`), then rows are inserted in batches.
  - `duplicate_auction()` copies settings, lots and reserves, but not photos.
  - `auction_analytics()` is available to the host or an admin.
- **Safety:** the `chat_zfilter` trigger blocks links for non-staff (unless `settings.chat.allow_links`) and masks words from `blocked_words`. `admin_fraud_signals()` reports shared IPs between bidder and host, single-host bidders who never win, frequent bidding pairs, bid bursts and brand-new accounts winning.
- **Search engines:** the Worker serves `robots.txt` and a `sitemap.xml` covering public auctions and hosts.

## Platform admin

- Rows in `platform_admins` can only be added with direct SQL. There is no UI or RPC for it, and clients have no grants on the table:
  ```sql
  insert into public.platform_admins (user_id) select id from auth.users where email = '<owner email>';
  ```
- `is_platform_admin()` gives full read access through `auction_visible()`, `is_auction_staff()`, the auctions policy, and extra admin `select` policies on private tables (reserves, proxies, contacts, deal chats, members, mutes, watchlist).
- Monitoring RPCs, which raise "Admins only" for anyone else: `admin_overview` (counts, DB and storage usage, table sizes, cron health), `admin_users`, `admin_user_detail`, `admin_auctions`, `admin_activity`.
- Moderation, recorded in `admin_audit_log`: `admin_set_ban`, `admin_cancel_auction`, `admin_delete_auction`, `admin_remove_chat`.
- UI: `/admin`. The link appears only for admins, and the page shows Not Found to everyone else.

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

### League upgrades

Settings in `settings.league`:

| Setting | Default | Meaning |
|---|---|---|
| `retain_max` | 4 | Players a team can keep |
| `rtm_cards` | 0 (off) | Right-to-match cards per team |
| `rtm_seconds` | 20 | Time to decide on a match |
| `category_max` | none | Per-category limit, e.g. `{"Overseas": 8}`, using `custom_fields.Category` |
| `trades` | true | Whether trades are allowed |
| `season` | none | Season number, set by `league_next_season()` |

- **Retention:** before the league starts, the host calls `league_retain()` or `league_unretain()`. The price comes out of the team's purse.
- **Right to match:**
  - `lots.rtm_team_id` names the previous owner.
  - When the player closes with another winner, `_close_lot` sets `rtm_offered`, extends the timer by `rtm_seconds` and notifies the previous owner.
  - `league_rtm(match)` decides. The timer running out counts as a pass.
  - The `bids_league_guard` trigger blocks other bids during the decision and enforces `category_max`.
- **Trades:**
  - Available while the league is paused or after it ends.
  - `league_propose_trade()` takes players in each direction plus cash. The receiving team calls `league_respond_trade()` to accept or reject.
  - The proposer or the host can cancel.
  - Squads and purses are re-checked when a trade is accepted. Other pending trades that involve the same players are cancelled.
- **Next season:** `league_next_season()` creates a draft league with the same teams and fresh purses, the same members, and every player. Each player's last owner gets the right to match.

## Price hints, webhooks, embed

- **Price hints:** `price_hint(category, currency, title)` returns the 25th, 50th and 75th percentile prices of public standard sales in that category over the last 365 days. It prefers title matches when there are at least 3. It returns null below 3 sales.
- **Webhooks:**
  - The `host_webhooks` table holds up to 5 per host. URLs must be https on a public host; private and internal addresses are refused.
  - Triggers on lot and auction status changes POST JSON through Supabase's built-in `pg_net`. The events are `auction.live`, `auction.ended`, `lot.sold` and `lot.unsold`.
  - The `X-AuctionHub-Signature` header is a hex HMAC-SHA256 of the body, keyed with the webhook's secret.
  - `test_webhook()` sends a ping.
- **Embed:** the Worker serves `/embed/:id`, a self-contained page. It reads the public REST API with the anon key, so RLS hides private auctions. It refreshes every 15 seconds and links to the room. Hosts copy an iframe snippet from the auction editor.

## Languages

`web/src/lib/i18n.ts` is a small helper with no extra dependencies:

- `t("English text", vars)`, where the English text is the key and missing keys fall back to English.
- Languages: Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi and Bengali, in `lib/locales/*.ts`.
- Each language loads on demand (about 3 KB gzipped).
- The language is the saved choice, else the browser language, else English.
- Changing the language remounts the routed UI.
- `i18n.test.ts` checks that every language has every key and keeps every `{placeholder}`.
- Server-generated text stays in English for now: error messages, chat system lines and notifications.

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
