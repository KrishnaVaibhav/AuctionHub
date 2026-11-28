import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  BroadcastIcon,
  CaretLeftIcon,
  CheckCircleIcon,
  CopyIcon,
  EnvelopeSimpleIcon,
  HandCoinsIcon,
  HandTapIcon,
  TimerIcon,
  TrophyIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useAuth } from "../../lib/auth";
import { supabase, errorMessage } from "../../lib/supabase";
import { CATEGORIES } from "../../lib/categories";
import { fromLocalInput } from "../../lib/format";
import { DURATIONS, TEMPLATES, durationLabel, settingsFor, templateByKey, type TemplateKey } from "../../lib/templates";
import type { Auction } from "../../lib/types";

const ICONS: Record<TemplateKey, Icon> = {
  timed: TimerIcon,
  rolling: BroadcastIcon,
  simple: HandTapIcon,
  offers: HandCoinsIcon,
  sealed: EnvelopeSimpleIcon,
  league: TrophyIcon,
};

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED", "PTS"];

const VISIBILITY: { key: Auction["visibility"]; title: string; desc: string }[] = [
  { key: "public", title: "Public", desc: "Listed on the home page" },
  { key: "unlisted", title: "Unlisted", desc: "Only people with the link" },
  { key: "private", title: "Private", desc: "Invite code needed" },
];

/**
 * New auction in one screen: pick a format, name it, say how long and when.
 * Formats only preset the rules; everything stays editable in the editor.
 */
export function NewAuction() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const userId = session!.user.id;
  const [params] = useSearchParams();
  // ?format= preselects a format (from the dashboard's first-auction cards).
  const [key, setKey] = useState<TemplateKey>(() => TEMPLATES.find((t) => t.key === params.get("format"))?.key ?? "timed");
  const template = templateByKey(key);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [minutes, setMinutes] = useState<number>(template.settings.lot_duration_minutes ?? 60);
  const [custom, setCustom] = useState(false);
  const [when, setWhen] = useState<"manual" | "scheduled">("manual");
  const [startsAt, setStartsAt] = useState("");
  const [visibility, setVisibility] = useState<Auction["visibility"]>("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [past, setPast] = useState<Pick<Auction, "id" | "title" | "status" | "created_at">[]>([]);

  // Your earlier auctions, to start from a copy instead.
  useEffect(() => {
    void supabase
      .from("auctions")
      .select("id, title, status, created_at")
      .eq("host_id", userId)
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => setPast((data as typeof past | null) ?? []));
  }, [userId]);

  function pick(next: TemplateKey) {
    setKey(next);
    const t = templateByKey(next);
    if (t.settings.lot_duration_minutes) setMinutes(t.settings.lot_duration_minutes);
    setCustom(false);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const start = when === "scheduled" ? fromLocalInput(startsAt) : null;
    if (when === "scheduled" && (!start || new Date(start).getTime() < Date.now() + 60_000)) {
      setError("Pick a start time at least a minute from now, or choose to start it yourself.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("auctions")
      .insert({
        host_id: userId,
        title: title.trim(),
        mode: template.mode,
        settings: settingsFor(template, { currency, durationMinutes: minutes }),
        category: category || null,
        visibility,
        starts_at: start,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return setError(errorMessage(error));
    navigate(`/host/a/${data.id}?tab=lots&welcome=1`);
  }

  async function copy(id: string) {
    setError(null);
    setBusy(true);
    const { data, error } = await supabase.rpc("duplicate_auction", { p_auction_id: id });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    navigate(`/host/a/${data}?tab=details`);
  }

  return (
    <div className="space-y-8">
      <Link to="/host" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
        <CaretLeftIcon size={16} weight="bold" aria-hidden="true" />
        Host dashboard
      </Link>
      <header className="-mt-4">
        <h1 className="page-title">New auction</h1>
        <p className="page-sub">Pick a format and name it. You'll add lots next, and you can change every rule later.</p>
      </header>

      <form onSubmit={create} className="space-y-8">
        <section className="space-y-3" aria-labelledby="fmt">
          <h2 id="fmt" className="section-title">
            1. How do you want to sell?
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Auction format">
            {TEMPLATES.map((t) => {
              const Glyph = ICONS[t.key];
              const on = t.key === key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => pick(t.key)}
                  className={`choice relative flex items-start gap-3 p-4 ${on ? "choice-on" : ""}`}
                >
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${on ? "bg-brand-500 text-ink" : "bg-brand-100 text-brand-700"}`}>
                    <Glyph size={22} weight="bold" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{t.title}</span>
                    <span className="mt-0.5 block text-sm text-stone-600">{t.blurb}</span>
                    <span className="mt-1.5 block text-xs font-medium text-stone-500">{t.bestFor}</span>
                  </span>
                  {on && <CheckCircleIcon size={20} weight="fill" className="absolute top-3 right-3 text-brand-600" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {past.length > 0 && (
            <details className="rounded-2xl bg-stone-900/[0.03] px-4 py-3 dark:bg-snow/[0.04]">
              <summary className="cursor-pointer text-sm font-semibold text-stone-700">Or start from a copy of one of your auctions</summary>
              <ul className="mt-3 divide-y divide-stone-900/[0.06] dark:divide-snow/[0.06]">
                {past.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-sm font-medium">{a.title}</span>
                    <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={busy} onClick={() => void copy(a.id)}>
                      <CopyIcon size={14} weight="bold" aria-hidden="true" />
                      Copy with its lots
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card space-y-5 p-5 sm:p-6" aria-labelledby="basics">
          <h2 id="basics" className="section-title">
            2. The basics
          </h2>
          <div>
            <label className="label" htmlFor="title">
              New auction title
            </label>
            <input
              id="title"
              className="input text-base"
              required
              minLength={3}
              maxLength={120}
              placeholder={template.mode === "league" ? "e.g. Office Premier League 2027" : "e.g. Vintage watches, Sunday night"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cat">
                Category <span className="font-normal normal-case">(optional)</span>
              </label>
              <select id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Choose later</option>
                {CATEGORIES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cur">
                Currency
              </label>
              <select id="cur" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c === "PTS" ? "PTS (points, no money)" : c}</option>
                ))}
              </select>
            </div>
          </div>

          {template.asksDuration && (
            <fieldset>
              <legend className="label">How long should each lot take bids?</legend>
              <div className="flex flex-wrap gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d.minutes}
                    type="button"
                    aria-pressed={!custom && minutes === d.minutes}
                    onClick={() => (setMinutes(d.minutes), setCustom(false))}
                    className={`chip min-h-10 border px-4 text-sm ${!custom && minutes === d.minutes ? "border-brand-500 bg-brand-50 text-brand-800" : "border-stone-900/[0.1] bg-white/60 text-stone-700"}`}
                  >
                    {d.label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={custom}
                  onClick={() => setCustom(true)}
                  className={`chip min-h-10 border px-4 text-sm ${custom ? "border-brand-500 bg-brand-50 text-brand-800" : "border-stone-900/[0.1] bg-white/60 text-stone-700"}`}
                >
                  Other
                </button>
              </div>
              {custom && (
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    className="input w-28"
                    aria-label="Minutes"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                  minutes <span className="text-stone-500">({durationLabel(minutes)})</span>
                </div>
              )}
              <p className="mt-1.5 text-xs text-stone-500">
                {key === "rolling" ? "Each next lot closes a minute after the one before. " : ""}You can also set one closing time for all lots later.
              </p>
            </fieldset>
          )}

          <fieldset>
            <legend className="label">When does it start?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" aria-pressed={when === "manual"} onClick={() => setWhen("manual")} className={`choice ${when === "manual" ? "choice-on" : ""}`}>
                <span className="block text-sm font-semibold">I'll start it myself</span>
                <span className="block text-xs text-stone-500">Press Go live when you're ready</span>
              </button>
              <button type="button" aria-pressed={when === "scheduled"} onClick={() => setWhen("scheduled")} className={`choice ${when === "scheduled" ? "choice-on" : ""}`}>
                <span className="block text-sm font-semibold">At a set time</span>
                <span className="block text-xs text-stone-500">It goes live by itself once scheduled</span>
              </button>
            </div>
            {when === "scheduled" && (
              <input
                type="datetime-local"
                className="input mt-2 sm:w-72"
                aria-label="Start time"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            )}
          </fieldset>

          <fieldset>
            <legend className="label">Who can see it?</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {VISIBILITY.map((v) => (
                <button key={v.key} type="button" aria-pressed={visibility === v.key} onClick={() => setVisibility(v.key)} className={`choice ${visibility === v.key ? "choice-on" : ""}`}>
                  <span className="block text-sm font-semibold">{v.title}</span>
                  <span className="block text-xs text-stone-500">{v.desc}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        {error && <p className="rounded-2xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-stone-500">Next: add your {template.mode === "league" ? "players" : "lots"}. Nothing goes live until you say so.</p>
          <button className="btn-accent px-7 py-3 text-base" disabled={busy}>
            {busy ? "Creating..." : "Create auction"}
          </button>
        </div>
      </form>
    </div>
  );
}
