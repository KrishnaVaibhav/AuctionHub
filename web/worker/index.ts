interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** Optional secret (wrangler secret / dashboard "Secret"). Enables the storage orphan sweep. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

import { embedPage } from "./embed";

const EMBED = /^\/embed\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const UUID = /^\/a\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

interface Preview {
  title: string;
  cover_url: string | null;
  visibility: string;
  status: string;
  host_name: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Serve the SPA for /a/:id with Open Graph tags so shared links show a preview card. */
async function auctionPage(request: Request, env: Env, id: string): Promise<Response> {
  const shell = await env.ASSETS.fetch(new Request(new URL("/", request.url), request));
  let preview: Preview | undefined;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/auction_preview`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_auction_id: id }),
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (res.ok) preview = ((await res.json()) as Preview[])[0];
  } catch {
    // Preview is best-effort; the app still loads.
  }
  if (!preview) return shell;

  const title = `${preview.title} · AuctionHub`;
  const what =
    preview.visibility === "private"
      ? "Private auction (invite only)"
      : preview.status === "live"
        ? "Live now. Join the room and bid"
        : preview.status === "scheduled"
          ? "Upcoming auction"
          : "Auction";
  const description = `${what}, hosted by ${preview.host_name} on AuctionHub.`;
  const url = new URL(request.url);
  url.search = "";
  const tags = [
    ["og:type", "website"],
    ["og:site_name", "AuctionHub"],
    ["og:title", title],
    ["og:description", description],
    ["og:url", url.toString()],
    ...(preview.cover_url ? [["og:image", preview.cover_url]] : []),
  ]
    .map(([p, c]) => `<meta property="${p}" content="${esc(c)}" />`)
    .concat([
      `<meta name="twitter:card" content="${preview.cover_url ? "summary_large_image" : "summary"}" />`,
      `<meta name="description" content="${esc(description)}" />`,
    ])
    .join("");

  const rewritten = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(title) })
    .on('meta[name="description"], meta[name="twitter:card"], meta[property^="og:"]', { element: (el) => void el.remove() })
    .on("head", { element: (el) => void el.append(tags, { html: true }) })
    .transform(shell);
  const headers = new Headers(rewritten.headers);
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(rewritten.body, { status: 200, headers });
}

function robots(origin: string): Response {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /host",
    "Disallow: /me",
    "Disallow: /account",
    "Disallow: /login",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

/** Public auctions and host profiles for search engines (private/unlisted/draft never listed). */
async function sitemap(origin: string, env: Env): Promise<Response> {
  const headers = { apikey: env.SUPABASE_ANON_KEY };
  const [auctions, hosts] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/auctions?select=id,updated_at,host_id&visibility=eq.public&status=neq.draft&order=updated_at.desc&limit=5000`, { headers })
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; updated_at: string; host_id: string }[]>) : []))
      .catch(() => []),
    fetch(`${env.SUPABASE_URL}/rest/v1/rpc/sitemap_hosts`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}" })
      .then((r) => (r.ok ? (r.json() as Promise<{ username: string }[]>) : []))
      .catch(() => []),
  ]);
  const urls = [
    `<url><loc>${origin}/</loc><changefreq>hourly</changefreq></url>`,
    ...auctions.map((a) => `<url><loc>${origin}/a/${a.id}</loc><lastmod>${a.updated_at.slice(0, 10)}</lastmod></url>`),
    ...hosts.map((h) => `<url><loc>${origin}/u/${encodeURIComponent(h.username)}</loc></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

const KEEPALIVE_CRON = "0 6 */2 * *";
const CLEANUP_CRON = "30 3 * * *";

async function pingSupabase(env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response("Supabase vars not configured", { status: 500 });
  }
  return fetch(`${env.SUPABASE_URL}/rest/v1/auctions?select=id&limit=1`, {
    headers: { apikey: env.SUPABASE_ANON_KEY },
  });
}

function serviceHeaders(key: string): Record<string, string> {
  // New-style secret keys go in `apikey` only; legacy service_role JWTs also need Authorization.
  return key.startsWith("sb_secret_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

/** Delete storage files no row references any more (deleted auctions/lots, replaced covers/avatars). */
async function sweepStorageOrphans(env: Env): Promise<number> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return 0;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/storage_orphans`, {
    method: "POST",
    headers: { ...serviceHeaders(key), "Content-Type": "application/json" },
    body: JSON.stringify({ p_limit: 1000 }),
  });
  if (!res.ok) throw new Error(`storage_orphans failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as { bucket_id: string; name: string }[];

  const byBucket = new Map<string, string[]>();
  for (const r of rows) byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r.name]);

  let removed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const del = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { ...serviceHeaders(key), "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: chunk }),
      });
      if (!del.ok) throw new Error(`storage delete failed (${bucket}): ${del.status} ${await del.text()}`);
      removed += chunk.length;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// League stats import: fetch a host's CSV/JSON link server-side (most sites
// block browser fetches). Hosts and co-hosts of that auction only.
// ---------------------------------------------------------------------------
const STATS_MAX_BYTES = 1_000_000;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public https URLs only: no IP literals, no local names, no odd ports, no credentials. */
export function safeStatsUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host)) return null;
  return u;
}

async function canRunAuction(env: Env, auth: string, auctionId: string): Promise<boolean> {
  for (const perm of ["run", "edit"]) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/auction_perm`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({ p_auction_id: auctionId, p_perm: perm }),
    });
    if (res.ok && (await res.json()) === true) return true;
  }
  return false;
}

async function statsFetch(request: Request, env: Env): Promise<Response> {
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
  if (request.method !== "POST") return fail("Method not allowed", 405);
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return fail("Sign in first", 401);
  let body: { url?: unknown; auction_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail("Bad request", 400);
  }
  const auctionId = typeof body.auction_id === "string" ? body.auction_id : "";
  if (!UUID_ONLY.test(auctionId)) return fail("Bad request", 400);
  const first = typeof body.url === "string" ? safeStatsUrl(body.url) : null;
  if (!first) return fail("Use a public https link", 400);
  let target: URL = first;
  if (!(await canRunAuction(env, auth, auctionId))) return fail("Only the host can import stats", 403);

  // Follow up to 3 redirects by hand so each hop passes the same URL check.
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(target.toString(), {
      redirect: "manual",
      headers: { accept: "text/csv, application/json, text/plain;q=0.9, */*;q=0.1", "user-agent": "AuctionHub stats import" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res) return fail("Could not reach that link", 502);
    if (res.status < 300 || res.status >= 400) break;
    const next: string | null = res.headers.get("location");
    const nextUrl: URL | null = next ? safeStatsUrl(new URL(next, target).toString()) : null;
    if (!nextUrl || hop === 3) return fail("That link redirects somewhere we can't follow", 502);
    target = nextUrl;
  }
  if (!res || !res.ok || !res.body) return fail(`That link answered ${res?.status ?? "nothing"}`, 502);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > STATS_MAX_BYTES) {
      await reader.cancel();
      return fail("That file is over 1 MB", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return new Response(new TextDecoder().decode(bytes), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const res = await pingSupabase(env);
      return Response.json({ ok: res.ok, supabase: res.status, orphanSweep: Boolean(env.SUPABASE_SERVICE_ROLE_KEY) }, { status: res.ok ? 200 : 502 });
    }
    if (url.pathname === "/api/stats-fetch") return statsFetch(request, env);
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (url.pathname === "/robots.txt") return robots(url.origin);
    if (url.pathname === "/sitemap.xml") return sitemap(url.origin, env);
    const embed = url.pathname.match(EMBED);
    if (embed && request.method === "GET") {
      return embedPage(embed[1].toLowerCase(), url.origin, env.SUPABASE_URL, env.SUPABASE_ANON_KEY, url.searchParams.get("theme") === "dark");
    }
    const match = url.pathname.match(UUID);
    if (match && request.method === "GET") {
      return auctionPage(request, env, match[1].toLowerCase());
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env) {
    if (controller.cron === CLEANUP_CRON) {
      const removed = await sweepStorageOrphans(env);
      console.log(`storage orphan sweep removed ${removed} files`);
      return;
    }
    if (controller.cron === KEEPALIVE_CRON) {
      const res = await pingSupabase(env);
      if (!res.ok) throw new Error(`Supabase keepalive failed: ${res.status} ${await res.text()}`);
    }
  },
} satisfies ExportedHandler<Env>;
