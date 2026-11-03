# Operations

Running AuctionHub on free tiers. Code is deployed automatically: CI tests every push, and on `main` it deploys
database migrations (`deploy-db`). Cloudflare builds and deploys the site.

## 1. Email (custom SMTP): required before real users

Supabase's built-in mailer sends only a few emails per hour. Sign-up confirmations and magic links will fail
under real traffic.

| Provider | Free tier | Sender setup |
|---|---|---|
| **Brevo** | 300 emails/day | Verify a single sender address. No domain needed. |
| **Resend** | 3,000/month (100/day) | Needs a domain you own (DNS records). |

Steps for Brevo:
1. Create an account and verify a sender address (Senders & IP → Senders).
2. Go to SMTP & API → SMTP and create an SMTP key. Note the host (`smtp-relay.brevo.com`), port `587` and login.
3. In Supabase, go to Project Settings → Authentication → SMTP Settings. Enable custom SMTP and enter the host,
   port, login, SMTP key, sender email and sender name `AuctionHub`.
4. In Authentication → Rate Limits, raise "emails per hour" (for example to 100).
5. Test: sign up with a new address and check the confirmation email arrives.

Never commit the SMTP key. It lives only in the Supabase dashboard.

## 2. Backups (encrypted, nightly)

`.github/workflows/backup.yml` runs daily at 02:40 UTC. It can also be started by hand from Actions → backup → Run workflow.
It dumps roles, schema and data, **encrypts them with AES-256**, and keeps them for 30 days as a workflow artifact.
Artifacts of a public repo can be downloaded by any GitHub user, which is why the job refuses to run without a passphrase.

Setup (one time):
1. Create a long random passphrase and store it in your password manager. **Without it, backups cannot be restored.**
2. Add it as a repository secret: Settings → Secrets and variables → Actions → New secret, named `BACKUP_PASSPHRASE`.
3. Go to Actions → backup → Run workflow and check that it succeeds.

Restore:
```bash
gpg -d auctionhub-YYYYMMDD-HHMM.tar.gz.gpg | tar -xz      # asks for the passphrase
# Restore into a NEW, empty Supabase project (connection string from Project Settings > Database):
psql "$DB_URL" -f backup/roles.sql
psql "$DB_URL" -f backup/schema.sql
psql "$DB_URL" -c "SET session_replication_role = replica" -f backup/data.sql
```

GitHub disables scheduled workflows in a public repo after 60 days with no commits. Push something, or run the
workflow by hand, at least every two months.

## 3. Error monitoring (Sentry, optional)

1. Create a free Sentry account and a **React** project. Copy its DSN.
2. In Cloudflare, open the Worker → Settings → Build → Variables and add `VITE_SENTRY_DSN` = the DSN. Then redeploy.

The SDK loads only when the DSN is set. User info, cookies, headers and URL query strings (for example invite codes)
are never sent. Worker errors appear in Cloudflare → Worker → Logs, because observability is enabled.

## 4. Storage orphan sweep (optional)

The Worker deletes unreferenced files every night at 03:30 UTC if it has the Supabase secret key:
Cloudflare Worker → Settings → Variables and Secrets → Add → type **Secret**, named `SUPABASE_SERVICE_ROLE_KEY`,
value from Supabase → Project Settings → API Keys (`sb_secret_...`). This key bypasses all security. Keep it only as a
Cloudflare Secret.

## 5. Tests

| Command | What it does |
|---|---|
| `npx supabase test db` | pgTAP database tests (rules, security, privacy) |
| `cd web && npm test` | unit tests |
| `cd web && npm run test:e2e` | Playwright browser tests (needs `npx supabase start` and `web/.env.local`) |

CI runs all three. `deploy-db` only runs when every check passes.

## 6. Admin

`/admin` is visible only to rows in `platform_admins`. To add an admin, run SQL as the project owner:
```sql
insert into public.platform_admins (user_id) values ('<auth user id>');
```
