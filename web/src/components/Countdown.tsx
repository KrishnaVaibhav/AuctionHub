import { useServerNow } from "../lib/clock";
import { remaining } from "../lib/format";

export function Countdown({ endsAt, className = "" }: { endsAt: string | null; className?: string }) {
  const now = useServerNow();
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now;
  const urgent = ms > 0 && ms < 30_000;
  return (
    <span className={`inline-flex items-center gap-1 font-mono tabular-nums ${urgent ? "text-red-600" : ""} ${className}`}>
      {urgent && (
        <>
          <svg viewBox="0 0 24 24" className="h-[0.9em] w-[0.9em]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 9v4l2 2M10 2h4" />
          </svg>
          <span className="sr-only">Closing soon:</span>
        </>
      )}
      {ms > 0 ? remaining(ms) : "Closing..."}
    </span>
  );
}
