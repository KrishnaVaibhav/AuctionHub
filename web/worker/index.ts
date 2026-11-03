interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** Optional secret (wrangler secret / dashboard "Secret"). Enables the storage orphan sweep. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const res = await pingSupabase(env);
      return Response.json({ ok: res.ok, supabase: res.status, orphanSweep: Boolean(env.SUPABASE_SERVICE_ROLE_KEY) }, { status: res.ok ? 200 : 502 });
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    if (url.pathname === "/robots.txt") return robots(url.origin);
    if (url.pathname === "/sitemap.xml") return sitemap(url.origin, env);
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
