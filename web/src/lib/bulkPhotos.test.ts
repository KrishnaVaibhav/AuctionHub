import { describe, expect, it } from "vitest";
import { baseName, lotNumber, planPhotos, runLimited, titleFromGroup } from "./bulkPhotos";

const file = (name: string, type = "image/jpeg") => new File(["x"], name, { type });
const lots = [
  { id: "a", position: 0, title: "Brass lamp" },
  { id: "b", position: 1, title: "Old map of Pune" },
  { id: "c", position: 11, title: "Lamp" },
];

describe("file names", () => {
  it("reads lot numbers", () => {
    expect(lotNumber("12.jpg")).toBe(12);
    expect(lotNumber("12-2.JPG")).toBe(12);
    expect(lotNumber("lot_3 front.png")).toBe(3);
    expect(lotNumber("brass-lamp.jpg")).toBeNull();
    expect(lotNumber("2024 trip.jpg")).toBe(2024);
  });
  it("strips copy markers", () => {
    expect(baseName("Brass lamp (2).JPG")).toBe("brass lamp");
    expect(baseName("brass_lamp-back.jpg")).toBe("brass lamp");
    expect(baseName("vase b.webp")).toBe("vase");
  });
  it("makes titles", () => expect(titleFromGroup("old  radio")).toBe("Old radio"));
});

describe("planPhotos", () => {
  it("matches by number, then title, else groups new lots", () => {
    const plan = planPhotos(
      [file("2.jpg"), file("brass-lamp_2.jpg"), file("12 a.jpg"), file("radio front.jpg"), file("radio back.jpg"), file("notes.pdf", "application/pdf")],
      lots,
    );
    const t = Object.fromEntries(plan.map((p) => [p.file.name, p.target]));
    expect(t["2.jpg"]).toEqual({ kind: "lot", lotId: "b" });
    expect(t["12 a.jpg"]).toEqual({ kind: "lot", lotId: "c" });
    expect(t["brass-lamp_2.jpg"]).toEqual({ kind: "lot", lotId: "a" });
    expect(t["radio front.jpg"]).toEqual({ kind: "new", group: "radio" });
    expect(t["radio back.jpg"]).toEqual({ kind: "new", group: "radio" });
    expect(plan.find((p) => p.file.name === "notes.pdf")).toBeUndefined();
  });
  it("sorts files naturally so photo order follows the names", () => {
    const plan = planPhotos([file("1-10.jpg"), file("1-2.jpg"), file("1.jpg")], lots);
    expect(plan.map((p) => p.file.name)).toEqual(["1.jpg", "1-2.jpg", "1-10.jpg"]);
  });
});

describe("runLimited", () => {
  it("runs every job with a cap on concurrency", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    await runLimited([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      active--;
    }, () => {});
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });
});
