import { useMemo } from "react";
import { prefersReducedMotion } from "../../lib/fun";

const COLORS = ["#fbbf24", "#f97316", "#f43f5e", "#10b981", "#0ea5e9", "#8b5cf6"];

/** A burst of CSS confetti from the centre; nothing when motion is reduced. */
export function Confetti({ pieces = 60 }: { pieces?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => {
        const angle = (Math.PI * 2 * i) / pieces + Math.random() * 0.5;
        const dist = 160 + Math.random() * 260;
        return {
          color: COLORS[i % COLORS.length],
          dx: `${Math.cos(angle) * dist}px`,
          dy: `${Math.sin(angle) * dist + 120}px`,
          rot: `${Math.random() * 720 - 360}deg`,
          delay: `${Math.random() * 120}ms`,
          w: 6 + Math.random() * 6,
        };
      }),
    [pieces],
  );
  if (prefersReducedMotion()) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          className="absolute rounded-[2px]"
          style={{
            width: b.w,
            height: b.w * 0.45,
            background: b.color,
            animation: `confetti 1.6s cubic-bezier(0.2, 0.7, 0.3, 1) ${b.delay} both`,
            ["--dx" as string]: b.dx,
            ["--dy" as string]: b.dy,
            ["--rot" as string]: b.rot,
          }}
        />
      ))}
    </div>
  );
}
