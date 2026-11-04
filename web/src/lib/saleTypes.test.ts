import { describe, expect, it } from "vitest";
import { dutchPrice, nextDropIn } from "./saleTypes";

const opened = "2026-11-04T10:00:00Z";
const lot = { start_price: 1000, opens_at: opened, sale_settings: { step: 100, floor: 400, interval_s: 60 } };
const at = (seconds: number) => new Date(opened).getTime() + seconds * 1000;

describe("dutchPrice", () => {
  it("starts at the opening price", () => expect(dutchPrice(lot, at(0))).toBe(1000));
  it("drops one step per full interval", () => expect(dutchPrice(lot, at(150))).toBe(800));
  it("never goes below the floor", () => expect(dutchPrice(lot, at(3600))).toBe(400));
  it("freezes while paused", () => expect(dutchPrice(lot, at(3600), new Date(at(61)).toISOString())).toBe(900));
});

describe("nextDropIn", () => {
  it("counts down to the next step", () => expect(nextDropIn(lot, at(150))).toBe(30_000));
  it("is zero at the floor", () => expect(nextDropIn(lot, at(3600))).toBe(0));
});
