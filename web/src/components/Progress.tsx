import { MedalIcon } from "@phosphor-icons/react";
import { badgeInfo, levelOf, levelProgress } from "../lib/fun";
import type { Badge } from "../lib/progress";
import { t } from "../lib/i18n";

/** Small "Lv 4" capsule next to a name. Levels 1-2 stay hidden to keep chat quiet. */
export function LevelChip({ xp, className = "" }: { xp: number | undefined; className?: string }) {
  const level = levelOf(xp ?? 0);
  if (level < 3) return null;
  const tone = level >= 15 ? "bg-rose-500 text-snow" : level >= 10 ? "bg-brand-400 text-ink" : level >= 5 ? "bg-stone-300 text-ink" : "bg-stone-900/[0.07] text-stone-600";
  return <span className={`chip px-1.5 py-0 text-[10px] tabular-nums ${tone} ${className}`}>{t("Lv {n}", { n: level })}</span>;
}

export function LevelBar({ xp }: { xp: number }) {
  const p = levelProgress(xp);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="font-display text-3xl font-extrabold tracking-tight">{t("Level {n}", { n: p.level })}</p>
        <p className="text-xs text-stone-500 tabular-nums">
          {t("{xp} / {to} XP", { xp, to: p.to })}
        </p>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-stone-900/[0.07]">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-rose-500 transition-[width] duration-700" style={{ width: `${p.pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-stone-500">{t("Earn XP by watching live rooms, chatting, guessing prices and rating trades. Spending never earns XP.")}</p>
    </div>
  );
}

export function BadgeGrid({ badges, events, empty }: { badges: Badge[]; events?: Map<string, string>; empty?: string }) {
  if (badges.length === 0) return <p className="text-sm text-stone-500">{empty ?? t("No badges yet.")}</p>;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {badges.map((b) => {
        const info = badgeInfo(b.badge, events);
        return (
          <li key={b.badge} className="flex items-center gap-2.5 rounded-2xl bg-stone-900/[0.035] p-2.5" title={t(info.desc)}>
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${info.tone}`}>
              <MedalIcon size={18} weight="fill" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{t(info.label)}</span>
              <span className="block truncate text-[11px] text-stone-500">{t(info.desc)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
