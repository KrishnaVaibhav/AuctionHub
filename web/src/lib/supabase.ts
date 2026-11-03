import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const supabase = createClient(url || "http://127.0.0.1:54321", key || "missing-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Turn a Supabase/PostgREST error into a message for the user. */
export function errorMessage(err: unknown): string {
  if (!err) return "Something went wrong";
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err && typeof err.message === "string") return err.message;
  return "Something went wrong";
}

/** Unique realtime channel name per subscription (same component may mount twice, e.g. desktop + mobile). */
export function channelName(base: string): string {
  return `${base}:${Math.random().toString(36).slice(2, 10)}`;
}
