interface Env {
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

async function pingSupabase(env: Env): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return new Response("Supabase vars not configured", { status: 500 });
  }
  return fetch(`${env.SUPABASE_URL}/rest/v1/auctions?select=id&limit=1`, {
    headers: { apikey: env.SUPABASE_ANON_KEY },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      const res = await pingSupabase(env);
      return Response.json({ ok: res.ok, supabase: res.status }, { status: res.ok ? 200 : 502 });
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env) {
    const res = await pingSupabase(env);
    if (!res.ok) {
      throw new Error(`Supabase keepalive failed: ${res.status} ${await res.text()}`);
    }
  },
} satisfies ExportedHandler<Env>;
