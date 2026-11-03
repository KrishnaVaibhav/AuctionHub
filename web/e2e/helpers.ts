import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

function env(name: string): string {
  if (process.env[name]) return process.env[name]!;
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const [k, ...v] = line.trim().split("=");
      if (k === name) return v.join("=");
    }
  }
  throw new Error(`${name} is not set`);
}

export const SUPABASE_URL = env("VITE_SUPABASE_URL");
export const ANON_KEY = env("VITE_SUPABASE_ANON_KEY");
export const PASSWORD = "E2eTest#2026";

export interface TestUser {
  email: string;
  id: string;
  client: SupabaseClient;
}

/** Creates (local Supabase: no email confirmation) and signs in a fresh user. */
export async function createUser(label: string, displayName = label): Promise<TestUser> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.localhost`;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD, options: { data: { display_name: displayName } } });
  if (error || !data.user) throw error ?? new Error("signup failed");
  return { email, id: data.user.id, client };
}

export async function rpc<T = unknown>(user: TestUser, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await user.client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Signs in through the real login form. */
export async function uiLogin(page: Page, user: TestUser, next = "/") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Password").press("Enter");
  await expect(page).not.toHaveURL(/\/login/);
}

/** Host creates a live standard auction with one lot via the API. */
export async function liveAuction(host: TestUser, opts: { title: string; visibility?: string; startPrice?: number }) {
  const { data: a, error } = await host.client
    .from("auctions")
    .insert({ host_id: host.id, title: opts.title, visibility: opts.visibility ?? "public", settings: { currency: "INR", lot_duration_minutes: 30 } })
    .select("id")
    .single();
  if (error) throw error;
  const { data: lot, error: e2 } = await host.client
    .from("lots")
    .insert({ auction_id: a.id, position: 0, title: "Test lot", start_price: opts.startPrice ?? 1000 })
    .select("id")
    .single();
  if (e2) throw e2;
  await rpc(host, "start_auction", { p_auction_id: a.id });
  return { auctionId: a.id as string, lotId: lot.id as string };
}
