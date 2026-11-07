import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

export function getTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function resolvedTheme(theme: Theme = getTheme()): "light" | "dark" {
  return theme === "system" ? (media().matches ? "dark" : "light") : theme;
}

/** Apply the theme to <html>. index.html runs the same logic inline before first paint. */
export function applyTheme(theme: Theme = getTheme()) {
  const dark = resolvedTheme(theme) === "dark";
  document.documentElement.classList.toggle("dark", dark);
  // glisse (the Liquid Glass components) reads the theme from data-theme.
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f0e0d" : "#fafaf9");
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  useEffect(() => {
    const sync = () => setThemeState(getTheme());
    window.addEventListener("themechange", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("themechange", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    // Follow the OS setting live while on "system".
    const mq = media();
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = (t: Theme) => {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
    setThemeState(t);
    window.dispatchEvent(new Event("themechange"));
  };
  return [theme, setTheme];
}
