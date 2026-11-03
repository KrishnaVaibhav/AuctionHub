import type { LeagueTeam } from "../../lib/types";

/** Pick black or white text for a team color. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#1c1917" : "#ffffff";
}

export function TeamChip({ team, size = "sm" }: { team: Pick<LeagueTeam, "short_name" | "color" | "name">; size?: "sm" | "lg" }) {
  return (
    <span
      title={team.name}
      className={`inline-flex items-center justify-center rounded-lg font-display font-extrabold tracking-wide ${size === "lg" ? "h-12 min-w-12 px-2 text-base" : "h-6 min-w-6 px-1.5 text-[11px]"}`}
      style={{ background: team.color, color: textOn(team.color) }}
    >
      {team.short_name}
    </span>
  );
}
