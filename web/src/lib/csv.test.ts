import { describe, expect, it } from "vitest";
import { CSV_TEMPLATE, LEAGUE_CSV_TEMPLATE, parseCsv, toLots } from "./csv";

describe("parseCsv", () => {
  it("handles quotes, commas, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });
  it("skips blank lines and a BOM", () => {
    expect(parseCsv("﻿x,y\n\n1,2\n")).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });
});

describe("toLots", () => {
  it("maps the standard template", () => {
    const { lots, errors } = toLots(parseCsv(CSV_TEMPLATE));
    expect(errors).toEqual([]);
    expect(lots).toHaveLength(2);
    expect(lots[0]).toMatchObject({ title: "Vintage camera", start_price: 1000, buy_now_price: 5000, reserve_price: 1500 });
    expect(lots[0].custom_fields).toEqual({ Condition: "Used", Year: "1975" });
    expect(lots[1].buy_now_price).toBeNull();
  });
  it("maps league aliases (player, base_price)", () => {
    const { lots } = toLots(parseCsv(LEAGUE_CSV_TEMPLATE));
    expect(lots[0]).toMatchObject({ title: "Player One", start_price: 20000000, custom_fields: { Role: "Batter", Country: "India" } });
  });
  it("reports bad rows and missing columns", () => {
    expect(toLots(parseCsv("name\nX")).errors[0]).toMatch(/start_price/);
    const { lots, errors } = toLots(parseCsv("title,price,buy_now\nGood,10,\nBad,abc,\nCheap,10,5"));
    expect(lots).toHaveLength(1);
    expect(errors).toEqual(["Line 3: start price is not a valid number", "Line 4: buy now must be higher than start price"]);
  });
});
