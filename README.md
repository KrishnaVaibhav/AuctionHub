# AuctionHub

Live auctions with real-time bidding, proxy (auto) bids, anti-sniping, live chat, host-managed media and an embedded live stream.
It runs entirely on free tiers: Cloudflare Workers and Supabase.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the architecture and business rules, and [docs/OPERATIONS.md](docs/OPERATIONS.md) for email, backups, monitoring and tests.

## Repo layout

```
web/                 React + Vite + Tailwind frontend, Cloudflare Worker (web/worker), wrangler.jsonc
supabase/migrations  Schema, RLS, bid engine, storage buckets (deployed by CI job deploy-db)
supabase/tests       pgTAP tests for the bid engine and security rules
.github/workflows    CI (typecheck, unit, DB and browser tests, DB deploy) and nightly encrypted backups
web/e2e              Playwright browser tests
```

## Local development

Requirements: Node 22+ and Docker.

```bash
npx supabase start                 # local Postgres, Auth, Realtime, Storage (applies migrations)
npx supabase status                # copy API URL + anon/publishable key
cp web/.env.example web/.env.local # paste them in
cd web && npm install && npm run dev   # http://127.0.0.1:5173
```

Useful commands:

```bash
npx supabase test db               # run database tests
npx supabase db reset              # rebuild local DB from migrations
npx supabase migration new <name>  # new migration file
cd web && npm test                 # unit tests
```

## Deploy

Pushing to `main` deploys both parts:

- **Supabase** applies new files in `supabase/migrations`. Migrations are forward-only. Never edit one after it has shipped. Add a new one instead.
- **Cloudflare** builds `web/` and runs `npx wrangler deploy`. Pull requests get preview URLs.

Cloudflare build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
