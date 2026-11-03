interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** Optional secret (wrangler secret / dashboard "Secret"). Enables the storage orphan sweep. */
  SUPABASE_SERVICE_ROLE_KEY?: string;
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
