import { useWatch } from "../lib/watchlist";

export function WatchButton({ lotId, userId, compact = false }: { lotId: string; userId: string | null; compact?: boolean }) {
  const [watching, toggle] = useWatch(lotId, userId);
  if (!userId) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void toggle();
      }}
      aria-pressed={watching}
      title={watching ? "Remove from watchlist" : "Add to watchlist"}
      className={`btn-ghost ${compact ? "px-2 py-1" : "py-1.5"} ${watching ? "border-brand-400 text-brand-700" : ""}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill={watching ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
      </svg>
      {!compact && (watching ? "Watching" : "Watch")}
    </button>
  );
}
