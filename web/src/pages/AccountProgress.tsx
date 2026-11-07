import { useEffect, useState, type FormEvent } from "react";
import { t } from "../lib/i18n";
import { CopySimpleIcon, LockSimpleIcon, MagnifyingGlassIcon, TrashIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../lib/supabase";
import { CHAT_COLORS, FRAMES, levelOf } from "../lib/fun";
import { useBadges, useEventTitles } from "../lib/progress";
import { shareCard } from "../lib/shareCard";
import { badgeInfo } from "../lib/fun";
import { CATEGORIES } from "../lib/categories";
import { BadgeGrid, LevelBar } from "../components/Progress";
import { Toggle } from "../components/Glass";

interface Me {
  xp: number;
  chat_color: string | null;
  frame: string | null;
  show_shelf: boolean;
  username: string;
}
interface Search {
  id: string;
  query: string;
  category: string | null;
  max_price: number | null;
}

const swatch: Record<string, string> = { amber: "bg-amber-500", emerald: "bg-emerald-500", sky: "bg-sky-500", violet: "bg-violet-500", rose: "bg-rose-500" };

export function AccountProgress({ userId }: { userId: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const badges = useBadges(userId);
  const events = useEventTitles();

  async function load() {
    const { data } = await supabase.from("profiles").select("xp, chat_color, frame, show_shelf, username").eq("id", userId).single();
    setMe(data as Me);
  }
  useEffect(() => {
    void load();
  }, [userId]);

  async function cosmetics(color: string | null, frame: string | null) {
    const { error } = await supabase.rpc("set_cosmetics", { p_color: color, p_frame: frame });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: t("Saved") });
    if (!error) await load();
  }
  async function shelf(on: boolean) {
    const { error } = await supabase.from("profiles").update({ show_shelf: on }).eq("id", userId);
    if (error) setMsg({ ok: false, text: errorMessage(error) });
    else await load();
  }

  if (!me) return <div className="h-48 animate-pulse rounded-[22px] bg-stone-900/[0.05]" />;
  const level = levelOf(me.xp);
  const invite = `${window.location.origin}/login?ref=${me.username}`;

  return (
    <>
      <section className="card space-y-5 p-5 sm:p-6">
        <LevelBar xp={me.xp} />

        <div className="space-y-2">
          <h3 className="label">{t("Chat name colour")} {level < 3 && <span className="normal-case">· {t("unlocks at level 3")}</span>}</h3>
          <div className="flex flex-wrap gap-2">
            <button className={`choice px-3 py-1.5 text-sm ${!me.chat_color ? "choice-on" : ""}`} onClick={() => void cosmetics(null, me.frame)}>
              {t("Default")}
            </button>
            {Object.keys(CHAT_COLORS).map((c) => (
              <button
                key={c}
                disabled={level < 3}
                aria-pressed={me.chat_color === c}
                aria-label={c}
                className={`flex h-9 w-9 items-center justify-center rounded-full ${swatch[c]} text-snow transition disabled:opacity-35 ${me.chat_color === c ? "ring-2 ring-offset-2 ring-stone-900" : ""}`}
                onClick={() => void cosmetics(c, me.frame)}
              >
                {level < 3 && <LockSimpleIcon size={14} weight="bold" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="label">{t("Avatar frame")}</h3>
          <div className="flex flex-wrap gap-2">
            <button className={`choice px-3 py-1.5 text-sm ${!me.frame ? "choice-on" : ""}`} onClick={() => void cosmetics(me.chat_color, null)}>
              {t("None")}
            </button>
            {(Object.entries(FRAMES) as [keyof typeof FRAMES, (typeof FRAMES)[keyof typeof FRAMES]][]).map(([f, info]) => (
              <button
                key={f}
                disabled={level < info.level}
                className={`choice flex items-center gap-1.5 px-3 py-1.5 text-sm capitalize ${me.frame === f ? "choice-on" : ""}`}
                onClick={() => void cosmetics(me.chat_color, f)}
              >
                {level < info.level && <LockSimpleIcon size={12} weight="bold" aria-hidden="true" />}
                {t(f)} <span className="text-xs text-stone-500">{t("Lv {n}", { n: info.level })}</span>
              </button>
            ))}
          </div>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      </section>

      <section className="card space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">{t("Badges ({n})", { n: badges.length })}</h2>
          {badges[0] && (
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => {
                const info = badgeInfo(badges[0].badge, events);
                void shareCard({ eyebrow: t("New badge"), headline: t(info.label), big: "🏅", footer: t(info.desc), accent: "#8b5cf6" }, "auctionhub-badge.png");
              }}
            >
              {t("Share latest")}
            </button>
          )}
        </div>
        <BadgeGrid badges={badges} events={events} empty={t("Win a lot, guess a price within 2% or finish a bingo line to earn your first badge.")} />
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-stone-900/[0.04] p-4">
          <span>
            <span className="block text-sm font-semibold">{t("Show my trophy shelf")}</span>
            <span className="block text-xs text-stone-500">{t("Lots you won in public auctions appear on your public profile.")}</span>
          </span>
          <Toggle checked={me.show_shelf} onChange={(v) => void shelf(v)} />
        </label>
      </section>

      <section className="card space-y-3 p-5 sm:p-6">
        <h2 className="section-title">{t("Invite a friend")}</h2>
        <p className="text-sm text-stone-500">{t("When a friend joins with your link and wins their first lot, you both get a badge.")}</p>
        <div className="flex gap-2">
          <input className="input font-mono text-xs" readOnly value={invite} onFocus={(e) => e.target.select()} aria-label={t("Your invite link")} />
          <button className="btn-primary shrink-0" onClick={() => void navigator.clipboard?.writeText(invite)}>
            <CopySimpleIcon size={16} aria-hidden="true" /> {t("Copy")}
          </button>
        </div>
      </section>

      <SavedSearches />
    </>
  );
}

function SavedSearches() {
  const [rows, setRows] = useState<Search[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [max, setMax] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("saved_searches").select("id, query, category, max_price").order("created_at");
    setRows((data as Search[] | null) ?? []);
  }
  useEffect(() => {
    void load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("saved_searches").insert({ query: query.trim(), category: category || null, max_price: max ? Number(max) : null });
    if (error) return setErr(errorMessage(error));
    setErr(null);
    setQuery("");
    setMax("");
    await load();
  }

  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <div>
        <h2 className="section-title">{t("Saved searches")}</h2>
        <p className="text-sm text-stone-500">{t("Get a notification when new lots match. Checked every 15 minutes.")}</p>
      </div>
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_10rem_8rem_auto]">
        <label className="relative">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-500" aria-hidden="true" />
          <input className="input pl-9" maxLength={80} placeholder={t("e.g. Rolex")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("Words to match")} />
        </label>
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("Category")}>
          <option value="">{t("Any category")}</option>
          {CATEGORIES.map(([v, l]) => (
            <option key={v} value={v}>
              {t(l)}
            </option>
          ))}
        </select>
        <input type="number" min={1} className="input" placeholder={t("Max price")} value={max} onChange={(e) => setMax(e.target.value)} aria-label={t("Maximum start price")} />
        <button className="btn-primary" disabled={!query.trim() && !category}>
          {t("Save")}
        </button>
      </form>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-stone-900/[0.06] text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span className="truncate">
                {r.query || t("Anything")}
                {r.category && <span className="text-stone-500"> · {r.category}</span>}
                {r.max_price && <span className="text-stone-500"> · {t("up to {amount}", { amount: r.max_price })}</span>}
              </span>
              <button
                className="btn-icon h-9 w-9"
                aria-label={t("Delete saved search {q}", { q: r.query })}
                onClick={async () => {
                  await supabase.from("saved_searches").delete().eq("id", r.id);
                  await load();
                }}
              >
                <TrashIcon size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
