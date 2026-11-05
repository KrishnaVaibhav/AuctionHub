import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DotsThreeIcon } from "@phosphor-icons/react";
import { t } from "../lib/i18n";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
}

/** Pull-down "More" menu on a glass popover: keeps rows to one or two visible actions. */
export function Menu({ items, label, children }: { items: MenuItem[]; label?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (visible.length === 0) return null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={children ? "btn-ghost" : "btn-ghost h-10 w-10 p-0"}
        aria-label={label ?? t("More")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {children ?? <DotsThreeIcon size={20} weight="bold" aria-hidden="true" />}
      </button>
      {open && (
        <div id={id} role="menu" className="glass absolute right-0 z-40 mt-2 min-w-44 origin-top-right animate-rise rounded-2xl p-1.5">
          {visible.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              className={`flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm font-medium transition hover:bg-stone-900/5 dark:hover:bg-snow/10 ${
                i.danger ? "text-red-600" : "text-stone-800"
              }`}
              onClick={() => {
                setOpen(false);
                i.onSelect();
              }}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
