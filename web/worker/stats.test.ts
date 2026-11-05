import { describe, expect, it } from "vitest";
import { safeStatsUrl } from "./index";

describe("safeStatsUrl", () => {
  it("allows public https links", () => {
    expect(safeStatsUrl("https://docs.google.com/spreadsheets/d/x/export?format=csv")?.hostname).toBe("docs.google.com");
    expect(safeStatsUrl("https://example.com:443/a.csv")).not.toBeNull();
  });
  it("blocks anything that could reach a private or odd target", () => {
    for (const bad of [
      "http://example.com/a.csv",
      "https://127.0.0.1/a",
      "https://10.0.0.5/a",
      "https://[::1]/a",
      "https://localhost/a",
      "https://printer.local/a",
      "https://metadata.internal/a",
      "https://intranet/a",
      "https://user:pw@example.com/a",
      "https://example.com:8443/a",
      "file:///etc/passwd",
      "nonsense",
    ])
      expect(safeStatsUrl(bad), bad).toBeNull();
  });
});
