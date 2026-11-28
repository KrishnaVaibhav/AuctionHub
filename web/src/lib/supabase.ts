import { createClient } from "@supabase/supabase-js";
import { t } from "./i18n";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url || "http://127.0.0.1:54321", key || "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// How browsers word "the request never reached the server" (Chrome, Firefox, Safari, React Native).
const NO_NETWORK = /failed to fetch|networkerror|load failed|network request failed/i;

/** Turn a Supabase/PostgREST error into a message for the user. */
export function errorMessage(err: unknown): string {
  if (!err) return t("Something went wrong");
  const message = typeof err === "string" ? err : typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : null;
  if (!message) return t("Something went wrong");
  // "TypeError: Failed to fetch" means nothing to a bidder.
  if (NO_NETWORK.test(message)) return t("Can't reach AuctionHub. Check your connection and try again.");
  return message;
}

/** Unique realtime channel name per subscription (same component may mount twice, e.g. desktop + mobile). */
export function channelName(base: string): string {
  return `${base}:${Math.random().toString(36).slice(2, 10)}`;
}
