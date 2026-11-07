import { DesktopIcon, MoonIcon, SunIcon, type Icon as PhIcon } from "@phosphor-icons/react";
import { useTheme, type Theme } from "../lib/theme";
import { Segmented } from "./Glass";

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
      className="flex h-11 w-11 items-center justify-center rounded-full text-stone-600 transition md:h-10 md:w-10 hover:bg-stone-900/5 hover:text-stone-900"
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
    <Segmented
      aria-label="Theme"
      width={100}
      value={theme}
      onChange={setTheme}
      items={order.map((t) => ({
        value: t,
        label: (
          <span className="flex items-center gap-1.5">
            <Icon theme={t} />
            {labels[t]}
          </span>
        ),
      }))}
    />
  );
}
