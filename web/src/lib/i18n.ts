import { useEffect, useState } from "react";

/**
 * Tiny dependency-free i18n. English text is the key; each language file maps
 * English to its translation and anything missing falls back to English.
 * Languages load on demand, so English users download nothing extra.
 */
export type Dict = Record<string, string>;

export const LANGUAGES = [
  { code: "en", native: "English" },
  { code: "hi", native: "हिन्दी" },
  { code: "ta", native: "தமிழ்" },
  { code: "te", native: "తెలుగు" },
  { code: "kn", native: "ಕನ್ನಡ" },
  { code: "ml", native: "മലയാളം" },
  { code: "mr", native: "मराठी" },
  { code: "bn", native: "বাংলা" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];

const loaders: Record<Exclude<Lang, "en">, () => Promise<{ default: Dict }>> = {
  hi: () => import("./locales/hi"),
  ta: () => import("./locales/ta"),
  te: () => import("./locales/te"),
  kn: () => import("./locales/kn"),
  ml: () => import("./locales/ml"),
  mr: () => import("./locales/mr"),
  bn: () => import("./locales/bn"),
};

const KEY = "lang";
let current: Lang = "en";
let dict: Dict = {};

/** Translate English text. Placeholders look like {name}. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = dict[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

export const getLanguage = () => current;

function isLang(v: string | null | undefined): v is Lang {
  return LANGUAGES.some((l) => l.code === v);
}

/** Saved choice, else the browser's first supported language, else English. */
export function initialLanguage(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l?.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

export async function setLanguage(code: Lang, persist = true): Promise<void> {
  dict = code === "en" ? {} : (await loaders[code]()).default;
  current = code;
  document.documentElement.lang = code;
  if (persist) {
    try {
      localStorage.setItem(KEY, code);
    } catch {
      /* storage blocked */
    }
  }
  window.dispatchEvent(new Event("languagechange-app"));
}

export function initI18n(): Promise<void> {
  return setLanguage(initialLanguage(), false).catch(() => setLanguage("en", false));
}

/** Current language; re-renders when it changes. */
export function useLanguage(): Lang {
  const [lang, setLang] = useState<Lang>(current);
  useEffect(() => {
    const sync = () => setLang(current);
    window.addEventListener("languagechange-app", sync);
    return () => window.removeEventListener("languagechange-app", sync);
  }, []);
  return lang;
}
