import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import bn from "./locales/bn";
import hi from "./locales/hi";
import kn from "./locales/kn";
import ml from "./locales/ml";
import mr from "./locales/mr";
import ta from "./locales/ta";
import te from "./locales/te";

const locales = { hi, ta, te, kn, ml, mr, bn };
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

describe("translations", () => {
  const reference = Object.keys(hi).sort();

  for (const [code, dict] of Object.entries(locales)) {
    it(`${code} covers every key`, () => expect(Object.keys(dict).sort()).toEqual(reference));
    it(`${code} keeps every {placeholder}`, () => {
      for (const [en, local] of Object.entries(dict)) expect(placeholders(local), `${code}: ${en}`).toBe(placeholders(en));
    });
    it(`${code} has no empty strings`, () => {
      for (const [en, local] of Object.entries(dict)) expect(local.trim(), `${code}: ${en}`).not.toBe("");
    });
  }
});

describe("t()", () => {
  it("falls back to English and fills placeholders", () => {
    expect(t("Bid {amount}", { amount: "₹500" })).toBe("Bid ₹500");
    expect(t("Not a real key")).toBe("Not a real key");
  });
});
