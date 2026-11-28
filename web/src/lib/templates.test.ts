import { describe, expect, it } from "vitest";
import { DURATIONS, TEMPLATES, durationLabel, settingsFor, templateByKey } from "./templates";

describe("auction templates", () => {
  it("each has a unique key and a usable starting point", () => {
    expect(new Set(TEMPLATES.map((t) => t.key)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(t.settings.currency).toBe("INR");
      if (t.mode === "league") expect(t.settings.league).toBeDefined();
      else expect(t.settings.lot_duration_minutes).toBeGreaterThan(0);
    }
  });

  it("applies the setup choices without touching the template", () => {
    const timed = templateByKey("timed");
    const s = settingsFor(timed, { currency: "USD", durationMinutes: 60 });
    expect(s.currency).toBe("USD");
    expect(s.lot_duration_minutes).toBe(60);
    expect(timed.settings.currency).toBe("INR");
    expect(timed.settings.lot_duration_minutes).toBe(1440);
  });

  it("caps the length at 7 days and ignores it for leagues", () => {
    expect(settingsFor(templateByKey("timed"), { durationMinutes: 99999 }).lot_duration_minutes).toBe(10080);
    expect(settingsFor(templateByKey("league"), { durationMinutes: 60 }).lot_duration_minutes).toBeUndefined();
  });

  it("offers and sealed bids set the sale type new lots start with", () => {
    expect(templateByKey("offers").settings.default_sale_type).toBe("offer");
    expect(templateByKey("sealed").settings.default_sale_type).toBe("sealed");
    expect(templateByKey("simple").settings.custom_bids).toBe(false);
  });
});

describe("durationLabel", () => {
  it("reads like a person would say it", () => {
    expect(durationLabel(10)).toBe("10 min");
    expect(durationLabel(90)).toBe("1 h 30 min");
    expect(durationLabel(1440)).toBe("1 day");
    expect(durationLabel(4320 + 120)).toBe("3 days 2 h");
    expect(DURATIONS.every((d) => durationLabel(d.minutes).length > 0)).toBe(true);
  });
});
