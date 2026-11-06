import { describe, expect, it } from "vitest";
import { TEAM_COLORS, freeColors, teamPalette } from "./useLeagueTeams";

describe("team colours", () => {
  it("offers one colour per allowed team", () => {
    expect(teamPalette(4)).toEqual(TEAM_COLORS.slice(0, 4));
    const big = teamPalette(24);
    expect(big).toHaveLength(24);
    expect(new Set(big).size).toBe(24);
    for (const c of big) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("hides colours other teams took, ignoring case", () => {
    expect(freeColors(3, ["#EF4444"])).toEqual(["#f59e0b", "#3b82f6"]);
    expect(freeColors(2, ["#f59e0b", "#ef4444"])).toEqual([]);
  });
});
