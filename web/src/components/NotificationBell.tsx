import { BellIcon, BroadcastIcon, ChatCircleIcon, CurrencyInrIcon, HourglassIcon, InfoIcon, LightningIcon, PackageIcon, TrophyIcon, type Icon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { useNotifications } from "../lib/notifications";
import { ago } from "../lib/admin";

const icons: Record<string, { Glyph: Icon; tint: string }> = {
  outbid: { Glyph: LightningIcon, tint: "bg-red-100 text-red-700" },
  won: { Glyph: TrophyIcon, tint: "bg-brand-100 text-brand-700" },
  sold: { Glyph: CurrencyInrIcon, tint: "bg-emerald-100 text-emerald-800" },
  unsold: { Glyph: PackageIcon, tint: "bg-stone-100 text-stone-600" },
  closing: { Glyph: HourglassIcon, tint: "bg-amber-100 text-amber-800" },
  live: { Glyph: BroadcastIcon, tint: "bg-red-100 text-red-700" },
  deal: { Glyph: ChatCircleIcon, tint: "bg-sky-100 text-sky-800" },
  system: { Glyph: InfoIcon, tint: "bg-stone-100 text-stone-600" },
};

export function NotificationBell() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { items, unread, markAllRead, markRead } = useNotifications(userId);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!userId) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-stone-600 transition md:h-10 md:w-10 hover:bg-stone-900/5 hover:text-stone-900"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
      >
        <BellIcon size={20} weight={unread ? "fill" : "bold"} aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-snow">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="glass absolute right-0 z-40 mt-3 w-[min(22rem,calc(100vw-2rem))] animate-rise overflow-hidden rounded-[24px]">
          <div className="flex items-center justify-between border-b border-stone-900/5 px-4 py-3 dark:border-snow/5">
            <p className="font-semibold">Notifications</p>
            {unread > 0 && (
              <button className="text-xs text-stone-500 hover:text-stone-900" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            )}
          </div>
          {perm === "default" && (
            <button
              className="w-full border-b border-stone-900/[0.06] bg-brand-50 px-4 py-2 text-left text-xs text-brand-700"
              onClick={() => void Notification.requestPermission().then(setPerm)}
            >
              Turn on pop-up alerts for outbids and wins while AuctionHub is open
            </button>
          )}
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-stone-500">You're all caught up.</p>}
            {items.map((n) => (
              <button
                key={n.id}
                className={`flex w-full gap-3 border-b border-stone-900/5 px-4 py-3 text-left transition last:border-0 hover:bg-white/50 dark:border-snow/5 dark:hover:bg-snow/5 ${n.read_at ? "" : "bg-brand-50"}`}
                onClick={() => {
                  void markRead(n.id);
                  setOpen(false);
                  if (n.link) navigate(n.link);
                }}
              >
                <NotifIcon kind={n.kind} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block text-xs text-stone-500">{n.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-stone-500">{ago(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotifIcon({ kind }: { kind: string }) {
  const { Glyph, tint } = icons[kind] ?? icons.system;
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tint}`}>
      <Glyph size={16} weight="bold" aria-hidden="true" />
    </span>
  );
}
