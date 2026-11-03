import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { supabase, errorMessage } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Mode = "signin" | "signup" | "magic";

export function Login() {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to={next} replace />;

  const redirectTo = `${window.location.origin}${next}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: redirectTo, data: { display_name: displayName } },
        });
        if (error) throw error;
        if (!data.session) setMessage("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setMessage("Check your email for a sign-in link.");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setError(errorMessage(error));
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold">{mode === "signup" ? "Create account" : "Sign in"}</h1>
      <div className="mt-4 flex gap-1 rounded-lg bg-stone-100 p-1 text-sm">
        {(["signin", "signup", "magic"] as Mode[]).map((m) => (
          <button
            key={m}
            className={`flex-1 rounded-md py-1.5 font-medium ${mode === m ? "bg-white shadow-sm" : "text-stone-500"}`}
            onClick={() => setMode(m)}
            type="button"
          >
            {m === "signin" ? "Password" : m === "signup" ? "Sign up" : "Email link"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "signup" && (
          <div>
            <label className="label" htmlFor="name">
              Display name
            </label>
            <input id="name" className="input" required maxLength={50} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== "magic" && (
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              required
              minLength={8}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Please wait..." : mode === "signup" ? "Create account" : mode === "magic" ? "Send link" : "Sign in"}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-stone-400">
        <span className="h-px flex-1 bg-stone-200" /> or <span className="h-px flex-1 bg-stone-200" />
      </div>
      <button className="btn-ghost w-full" onClick={() => void google()}>
        Continue with Google
      </button>
    </div>
  );
}
