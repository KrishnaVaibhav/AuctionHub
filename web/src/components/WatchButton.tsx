import { StarIcon } from "@phosphor-icons/react";
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
      <StarIcon size={16} weight={watching ? "fill" : "bold"} aria-hidden="true" />
      {!compact && (watching ? "Watching" : "Watch")}
    </button>
  );
}
