import { TranslateIcon } from "@phosphor-icons/react";
import { LANGUAGES, setLanguage, t, useLanguage, type Lang } from "../lib/i18n";

/** Icon button with a native select on top: works with touch, keyboard and screen readers. */
export function LanguagePicker({ full = false }: { full?: boolean }) {
  const lang = useLanguage();
  const select = (
    <select
      aria-label={t("Language")}
      value={lang}
      onChange={(e) => void setLanguage(e.target.value as Lang)}
      className={full ? "input" : "absolute inset-0 cursor-pointer opacity-0"}
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.native}
        </option>
      ))}
    </select>
  );
  if (full) return select;
  return (
    <span className="relative flex h-11 w-11 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-900/5 hover:text-stone-900 md:h-10 md:w-10 dark:hover:bg-snow/5">
      <TranslateIcon size={19} weight="bold" aria-hidden="true" />
      {select}
    </span>
  );
}
