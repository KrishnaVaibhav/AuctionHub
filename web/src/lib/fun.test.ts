import { describe, expect, it } from "vitest";
import { bingoCard, bingoHits, bingoLine, diffLot, funOn, hypeLevel, levelOf, levelProgress, showdown, type PulseEvent } from "./fun";
import type { Lot } from "./types";

const lot = (over: Partial<Lot>): Lot =>
  ({ id: "l1", auction_id: "a", position: 0, title: "x", description: "", start_price: 100, buy_now_price: null, custom_fields: {}, status: "open", current_bid: null, current_winner_id: null, bid_count: 0, reserve_met: true, opens_at: null, ends_at: "2026-01-01T00:00:00Z", created_at: "", ...over }) as Lot;

describe("features and levels", () => {
  it("defaults features on", () => {
    expect(funOn({}, "reactions")).toBe(true);
    expect(funOn({ fun: { reactions: false } } as never, "reactions")).toBe(false);
  });
  it("matches the SQL level curve", () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(49)).toBe(1);
    expect(levelOf(50)).toBe(2);
    expect(levelOf(200)).toBe(3);
    expect(levelProgress(125).pct).toBe(50);
  });
});

describe("pulse", () => {
  const bid = (winner: string, at = 0, amount = 0): PulseEvent => ({ lotId: "l1", at, kind: "bid", winner, amount });
  it("detects bids, extensions and sales from row changes", () => {
    expect(diffLot(lot({}), lot({ bid_count: 1, current_bid: 100, current_winner_id: "u" }), 5)).toEqual([
      { lotId: "l1", at: 5, kind: "bid", winner: "u", amount: 100 },
    ]);
    expect(diffLot(lot({}), lot({ ends_at: "2026-01-01T00:00:30Z" }), 5)[0].kind).toBe("extend");
    expect(diffLot(lot({}), lot({ status: "sold" }), 5)[0].kind).toBe("sold");
    expect(diffLot(undefined, lot({}), 5)).toEqual([]);
  });
  it("measures hype over the last minute", () => {
    expect(hypeLevel([bid("a", 0), bid("b", 1000)], 30_000)).toBe(0.25);
    expect(hypeLevel([bid("a", 0)], 90_000)).toBe(0);
  });
  it("spots a showdown after four alternating leads", () => {
    expect(showdown([bid("a"), bid("b"), bid("a")], "l1")).toBeNull();
    expect(showdown([bid("c"), bid("a"), bid("b"), bid("a"), bid("b")], "l1")).toEqual(["a", "b"]);
    expect(showdown([bid("a"), bid("a"), bid("b"), bid("a"), bid("b")], "l1")).toEqual(["a", "b"]);
  });
});

describe("bingo", () => {
  it("deals the same 9 distinct squares per seed", () => {
    const card = bingoCard("user:auction");
    expect(card).toHaveLength(9);
    expect(new Set(card).size).toBe(9);
    expect(bingoCard("user:auction")).toEqual(card);
    expect(bingoCard("other:auction")).not.toEqual(card);
  });
  it("marks events and finds a line", () => {
    const hits = bingoHits([lot({ status: "sold", current_bid: 300, bid_count: 12 }), lot({ id: "l2", status: "unsold" })], []);
    expect([...hits].sort()).toEqual(["double", "first_bid", "ten_bids", "triple", "unsold"]);
    const card = ["double", "triple", "unsold", "x", "y", "z", "p", "q", "r"];
    expect(bingoLine(card, hits)).toEqual([0, 1, 2]);
    expect(bingoLine(card, new Set(["double"]))).toBeNull();
  });
});
