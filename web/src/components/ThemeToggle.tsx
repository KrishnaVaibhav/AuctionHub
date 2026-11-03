import type { ReactNode } from "react";
import { useTheme, type Theme } from "../lib/theme";

const icons: Record<Theme, ReactNode> = {
  light: (
    <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66 5.66 1.41 1.41M4.93 4.93l1.41 1.41m11.32 0 1.41-1.41M4.93 19.07l1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
  ),
  dark: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
  system: <path d="M3 5h18v11H3zM8 20h8M12 16v4" />,
};

const labels: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };
const order: Theme[] = ["light", "dark", "system"];

function Icon({ theme }: { theme: Theme }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[theme]}
    </svg>
  );
}

/** Compact icon button: cycles Light -> Dark -> System. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = order[(order.indexOf(theme) + 1) % order.length];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      title={`Theme: ${labels[theme]} (switch to ${labels[next]})`}
      aria-label={`Theme: ${labels[theme]}. Switch to ${labels[next]}`}
    >
      <Icon theme={theme} />
    </button>
  );
}

/** Segmented control for menus and settings. */
export function ThemeSegmented() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex gap-1 rounded-xl bg-stone-100 p-1" role="radiogroup" aria-label="Theme">
      {order.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => setTheme(t)}
          className={`tab flex flex-1 items-center justify-center gap-1.5 ${theme === t ? "tab-active" : ""}`}
        >
          <Icon theme={t} />
          {labels[t]}
        </button>
      ))}
    </div>
  );
}
