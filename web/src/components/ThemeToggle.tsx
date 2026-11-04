import { DesktopIcon, MoonIcon, SunIcon, type Icon as PhIcon } from "@phosphor-icons/react";
import { useTheme, type Theme } from "../lib/theme";

const icons: Record<Theme, PhIcon> = { light: SunIcon, dark: MoonIcon, system: DesktopIcon };

const labels: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };
const order: Theme[] = ["light", "dark", "system"];

function Icon({ theme }: { theme: Theme }) {
  const Glyph = icons[theme];
  return <Glyph size={18} weight="bold" aria-hidden="true" />;
}

/** Compact icon button: cycles Light -> Dark -> System. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = order[(order.indexOf(theme) + 1) % order.length];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="flex h-11 w-11 items-center justify-center rounded-full text-stone-600 transition md:h-10 md:w-10 hover:bg-stone-100 hover:text-stone-900"
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
    <div className="flex gap-1 rounded-full bg-stone-200/60 p-1" role="radiogroup" aria-label="Theme">
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
