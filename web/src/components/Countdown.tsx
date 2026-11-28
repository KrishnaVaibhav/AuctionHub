import { t } from "../lib/i18n";
import { TimerIcon } from "@phosphor-icons/react";
import { useSecondsLeft } from "../lib/clock";
import { remaining } from "../lib/format";

export function Countdown({ endsAt, className = "" }: { endsAt: string | null; className?: string }) {
  // Whole seconds, rounded up: re-renders once a second, all countdowns on one shared timer.
  const left = useSecondsLeft(endsAt);
  if (left == null) return null;
  const urgent = left > 0 && left <= 30;
  return (
    <span className={`inline-flex items-center gap-1 font-mono tabular-nums ${urgent ? "text-red-600" : ""} ${className}`}>
      {urgent && (
        <>
          <TimerIcon size="0.95em" weight="bold" aria-hidden="true" />
          <span className="sr-only">{t("Closing soon:")}</span>
        </>
      )}
      {/* `left` counts up to the next whole second, so the clock shows one less ("0:00" in the last second). */}
      {left > 0 ? remaining((left - 1) * 1000 + 1) : t("Closing...")}
    </span>
  );
}
