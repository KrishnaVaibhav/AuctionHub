import { describe, expect, it } from "vitest";
import { formatScoring, parseScoring, parseStatsSheet, teamTotals } from "./leagueMatches";

const players = [
  { id: "1", title: "Virat Kohli" },
  { id: "2", title: "Jasprit Bumrah" },
  { id: "3", title: "Rohit Sharma" },
  { id: "4", title: "Ishan Sharma" },
];

describe("parseStatsSheet", () => {
  it("maps players and numeric stats", () => {
    const { rows, unmatched, columns } = parseStatsSheet("Player,Runs,Wickets\nvirat kohli,82,\nBumrah,4,3\nSharma,10,0\nNobody,1,1\n", players);
    expect(columns).toEqual(["runs", "wickets"]);
    expect(rows).toEqual([
      { lot_id: "1", stats: { runs: 82 } },
      { lot_id: "2", stats: { runs: 4, wickets: 3 } },
    ]);
    expect(unmatched).toEqual(["Sharma", "Nobody"]);
  });
  it("uses a points column as an override and ignores duplicates", () => {
    const { rows } = parseStatsSheet("name,runs,points\nRohit Sharma,30,99\nRohit Sharma,5,1", players);
    expect(rows).toEqual([{ lot_id: "3", stats: { runs: 30 }, points: 99 }]);
  });
  it("needs a header and a row", () => expect(parseStatsSheet("player,runs", players).rows).toEqual([]));
});

describe("scoring rules", () => {
  it("round-trips", () => {
    const r = parseScoring("Runs: 1, wickets = 25\ncatches: 8, bad");
    expect(r).toEqual({ runs: 1, wickets: 25, catches: 8 });
    expect(formatScoring(r)).toBe("runs: 1, wickets: 25, catches: 8");
  });
});

describe("teamTotals", () => {
  it("sums points and counts matches", () => {
    const t = teamTotals([
      { match_id: "m1", team_id: "a", points: 10, captain_lot_id: null, vice_lot_id: null },
      { match_id: "m2", team_id: "a", points: 5.5, captain_lot_id: null, vice_lot_id: null },
    ]);
    expect(t.get("a")).toEqual({ points: 15.5, matches: 2 });
  });
});
