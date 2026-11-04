import { t } from "../lib/i18n";
import { TimerIcon } from "@phosphor-icons/react";
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
          <TimerIcon size="0.95em" weight="bold" aria-hidden="true" />
          <span className="sr-only">{t("Closing soon:")}</span>
        </>
      )}
      {ms > 0 ? remaining(ms) : t("Closing...")}
    </span>
  );
}
