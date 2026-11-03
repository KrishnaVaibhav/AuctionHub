import { useServerNow } from "../lib/clock";
import { remaining } from "../lib/format";

export function Countdown({ endsAt, className = "" }: { endsAt: string | null; className?: string }) {
  const now = useServerNow();
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now;
  const urgent = ms > 0 && ms < 30_000;
  return (
    <span className={`font-mono tabular-nums ${urgent ? "text-red-600" : ""} ${className}`}>
      {ms > 0 ? remaining(ms) : "Closing..."}
    </span>
  );
}
