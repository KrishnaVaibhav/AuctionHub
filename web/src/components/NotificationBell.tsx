import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth";
import { useNotifications } from "../lib/notifications";
import { ago } from "../lib/admin";

const icons: Record<string, string> = { outbid: "⚡", won: "🏆", sold: "💰", unsold: "📦", closing: "⏳", live: "🔴", deal: "💬", system: "ℹ️" };

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
        className="relative flex h-11 w-11 items-center md:h-10 md:w-10 justify-center rounded-xl text-stone-600 hover:bg-stone-100 hover:text-stone-900"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-snow">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-rise overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <p className="font-semibold">Notifications</p>
            {unread > 0 && (
              <button className="text-xs text-stone-500 hover:text-stone-900" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            )}
          </div>
          {perm === "default" && (
            <button
              className="w-full border-b border-stone-100 bg-brand-50 px-4 py-2 text-left text-xs text-brand-700"
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
                className={`flex w-full gap-3 border-b border-stone-100 px-4 py-3 text-left last:border-0 hover:bg-stone-50 ${n.read_at ? "" : "bg-brand-50"}`}
                onClick={() => {
                  void markRead(n.id);
                  setOpen(false);
                  if (n.link) navigate(n.link);
                }}
              >
                <span className="text-lg leading-none">{icons[n.kind] ?? "•"}</span>
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
