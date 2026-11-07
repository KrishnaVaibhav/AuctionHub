import { useEffect, useRef, useState } from "react";
import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { t } from "../lib/i18n";
import { useProfileNames } from "../lib/profiles";
import type { Auction, ChatMessage } from "../lib/types";
import { ChatPanel } from "./ChatPanel";
import { LiquidGlass } from "./Glass";

function useIsDesktop() {
  const query = "(min-width: 1024px)";
  const [desktop, setDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setDesktop(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return desktop;
}

/** The chat column beside the room, mounted on desktop only (phones use FloatingChat). */
export function DesktopChat({ auction, userId, isStaff }: { auction: Auction; userId: string | null; isStaff: boolean }) {
  const desktop = useIsDesktop();
  if (!desktop) return null;
  return (
    <aside className="sticky top-24 self-start">
      <ChatPanel auction={auction} userId={userId} isStaff={isStaff} />
    </aside>
  );
}

/**
 * Phone and tablet chat that floats over the room, so people can follow the
 * chat and bid at the same time. Closed: a bubble at the bottom right with an
 * unread count and a peek at the newest message. Open: a panel over the lower
 * part of the screen, above the sticky bid bar. Desktop keeps the side column.
 */
export function FloatingChat({
  auction,
  userId,
  isStaff,
  lift,
  startOpen = false,
}: {
  auction: Auction;
  userId: string | null;
  isStaff: boolean;
  /** True while the sticky bid bar is showing, so the chat sits above it. */
  lift: boolean;
  startOpen?: boolean;
}) {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(startOpen);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [seen, setSeen] = useState<number | null>(null);
  const [peek, setPeek] = useState<ChatMessage | null>(null);
  const lastId = useRef<number | null>(null);

  const latest = messages.filter((m) => !m.deleted_at).at(-1) ?? null;
  const names = useProfileNames(latest?.user_id ? [latest.user_id] : []);

  // First load counts as read; after that, new messages while closed are unread.
  useEffect(() => {
    if (seen === null && messages.length) setSeen(messages.at(-1)!.id);
    if (open && messages.length) setSeen(messages.at(-1)!.id);
  }, [messages, open, seen]);

  // Peek at a new message for a few seconds while closed.
  useEffect(() => {
    if (!latest || latest.id === lastId.current) return;
    const first = lastId.current === null;
    lastId.current = latest.id;
    if (first || open || latest.user_id === userId) return;
    setPeek(latest);
    const id = setTimeout(() => setPeek(null), 5000);
    return () => clearTimeout(id);
  }, [latest, open, userId]);

  if (desktop || auction.settings.chat?.enabled === false) return null;

  const unread = seen === null ? 0 : messages.filter((m) => m.id > seen && !m.deleted_at && m.user_id !== userId).length;
  const bottom = lift ? "calc(max(0.75rem, env(safe-area-inset-bottom)) + 5.75rem)" : "max(1rem, env(safe-area-inset-bottom))";

  return (
    <>
      {/* The panel stays mounted so messages keep arriving while minimised. */}
      <LiquidGlass
        className={`thick fixed inset-x-3 z-30 overflow-hidden rounded-[26px] transition duration-300 ease-[var(--ease-spring)] ${
          open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
        }`}
        style={{ bottom, height: "min(46dvh, 26rem)" }}
        aria-hidden={!open}
      >
        <ChatPanel auction={auction} userId={userId} isStaff={isStaff} compact onClose={() => setOpen(false)} onMessages={setMessages} />
      </LiquidGlass>

      {!open && (
        <div className="fixed right-3 z-30 flex max-w-[calc(100vw-1.5rem)] items-end gap-2" style={{ bottom }}>
          {peek && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              data-no-press className="glass animate-rise max-w-64 truncate rounded-2xl px-3 py-2 text-left text-sm shadow-lg"
            >
              <strong className="mr-1">{(peek.user_id && names.get(peek.user_id)) ?? t("Bidder")}:</strong>
              {peek.body}
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink text-snow shadow-[0_12px_30px_-10px_rgb(0_0_0/0.6)] transition active:scale-95"
            aria-label={unread ? t("Open chat ({n} new)", { n: unread }) : t("Open chat")}
          >
            <ChatCircleDotsIcon size={26} weight="fill" aria-hidden="true" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs font-bold tabular-nums">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </div>
      )}
    </>
  );
}
