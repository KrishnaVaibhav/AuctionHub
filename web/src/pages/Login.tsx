import { t } from "../lib/i18n";
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
        if (!data.session) setMessage(t("Check your email to confirm your account."));
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setMessage(t("Check your email for a sign-in link."));
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
    <div className="aurora -mx-4 -my-6 flex min-h-[calc(100dvh-10rem)] items-center justify-center px-4 py-10 sm:-mx-6 sm:-my-8 sm:rounded-[36px]">
    <div className="glass enter w-full max-w-sm rounded-[32px] p-6 sm:p-8">
      <img src="/favicon.svg" alt="" className="mx-auto h-12 w-12" />
      <h1 className="mt-4 text-center font-display text-2xl font-extrabold tracking-tight">{t(mode === "signup" ? "Create account" : "Sign in")}</h1>
      <div className="segmented mt-5 flex w-full" role="tablist">
        {(["signin", "signup", "magic"] as Mode[]).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`tab flex-1 justify-center px-2 ${mode === m ? "tab-active" : ""}`}
            onClick={() => setMode(m)}
            type="button"
          >
            {t(m === "signin" ? "Password" : m === "signup" ? "Sign up" : "Email link")}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "signup" && (
          <div>
            <label className="label" htmlFor="name">
              {t("Display name")}
            </label>
            <input id="name" className="input" required maxLength={50} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">
            {t("Email")}
          </label>
          <input id="email" type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode !== "magic" && (
          <div>
            <label className="label" htmlFor="password">
              {t("Password")}
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
        <button className="btn-accent w-full py-3" disabled={busy}>
          {t(busy ? "Please wait..." : mode === "signup" ? "Create account" : mode === "magic" ? "Send link" : "Sign in")}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-stone-500">
        <span className="h-px flex-1 bg-stone-900/10 dark:bg-snow/10" /> {t("or")} <span className="h-px flex-1 bg-stone-900/10 dark:bg-snow/10" />
      </div>
      <button className="btn-ghost w-full py-3" onClick={() => void google()}>
        {t("Continue with Google")}
      </button>
    </div>
    </div>
  );
}
