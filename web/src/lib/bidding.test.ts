import { describe, expect, it } from "vitest";
import { bidIncrement, looksLikeTypo, minNextBid } from "./bidding";
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
  it("asks for one increment when the lot starts at 0", () => {
    expect(minNextBid({ current_bid: null, start_price: 0 })).toBe(10);
    expect(minNextBid({ current_bid: null, start_price: 0 }, { increments: [[0, 25]] })).toBe(25);
  });
});

describe("looksLikeTypo", () => {
  it("flags an extra zero", () => {
    expect(looksLikeTypo(10500, 1050, 50)).toBe(true);
  });
  it("lets normal jumps through", () => {
    expect(looksLikeTypo(1250, 1050, 50)).toBe(false);
    expect(looksLikeTypo(2100, 1050, 50)).toBe(true);
    // Five steps above a tiny minimum is still a normal raise.
    expect(looksLikeTypo(40, 10, 10)).toBe(false);
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
  it("uses YouTube's privacy-enhanced player", () => {
    expect(embedUrl("https://youtu.be/abc123XYZ")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/abc123XYZ\?/);
  });
  it("refuses malformed video ids and channels", () => {
    expect(embedUrl("https://youtu.be/abc/../../x")).toBeNull();
    expect(embedUrl("https://www.youtube.com/watch?v=a%26b")).toBeNull();
    expect(embedUrl("https://twitch.tv/some&parent=evil.com")).toBeNull();
  });
  it("builds Twitch player links with every parameter encoded", () => {
    const src = new URL(embedUrl("https://www.twitch.tv/some_channel", "auctionhub.test")!);
    expect(src.origin).toBe("https://player.twitch.tv");
    expect(src.searchParams.get("channel")).toBe("some_channel");
    expect(src.searchParams.get("parent")).toBe("auctionhub.test");
  });
  it("returns null for unknown hosts", () => {
    expect(embedUrl("https://example.com/video")).toBeNull();
    expect(embedUrl("not a url")).toBeNull();
  });
});
