import { describe, expect, it } from "vitest";
import { bidIncrement, minNextBid } from "./bidding";
import { embedUrl } from "../components/StreamEmbed";
import { parseIncrements, remaining } from "./format";

describe("bidIncrement", () => {
  it("uses the default table", () => {
    expect(bidIncrement(0)).toBe(10);
    expect(bidIncrement(999)).toBe(10);
    expect(bidIncrement(1000)).toBe(50);
    expect(bidIncrement(250000)).toBe(5000);
  });

  it("uses a custom table regardless of order", () => {
    const settings = { increments: [[500, 25], [0, 5]] as [number, number][] };
    expect(bidIncrement(100, settings)).toBe(5);
    expect(bidIncrement(500, settings)).toBe(25);
  });
});

describe("minNextBid", () => {
  it("is the start price before any bids", () => {
    expect(minNextBid({ current_bid: null, start_price: 250 })).toBe(250);
  });
  it("adds one increment to the current bid", () => {
    expect(minNextBid({ current_bid: 1000, start_price: 250 })).toBe(1050);
  });
});

describe("parseIncrements", () => {
  it("parses and sorts", () => {
    expect(parseIncrements("1000:50, 0:10")).toEqual([
      [0, 10],
      [1000, 50],
    ]);
  });
  it("rejects bad input", () => {
    expect(parseIncrements("0:0")).toBeNull();
    expect(parseIncrements("abc")).toBeNull();
    expect(parseIncrements("")).toBeNull();
  });
});

describe("remaining", () => {
  it("formats durations", () => {
    expect(remaining(9_000)).toBe("0:09");
    expect(remaining(65_000)).toBe("1:05");
    expect(remaining(3_700_000)).toBe("1h 1m");
    expect(remaining(0)).toBe("0:00");
  });
});

describe("embedUrl", () => {
  it("handles YouTube links", () => {
    expect(embedUrl("https://www.youtube.com/watch?v=abc123XYZ")).toContain("/embed/abc123XYZ");
    expect(embedUrl("https://youtu.be/abc123XYZ")).toContain("/embed/abc123XYZ");
    expect(embedUrl("https://www.youtube.com/live/abc123XYZ")).toContain("/embed/abc123XYZ");
  });
  it("returns null for unknown hosts", () => {
    expect(embedUrl("https://example.com/video")).toBeNull();
    expect(embedUrl("not a url")).toBeNull();
  });
});
