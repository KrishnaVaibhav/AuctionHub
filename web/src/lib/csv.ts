/** Minimal RFC 4180 CSV parser: quotes, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportedLot {
  title: string;
  start_price: number;
  buy_now_price: number | null;
  reserve_price: number | null;
  description: string;
  custom_fields: Record<string, string>;
}

const KNOWN: Record<string, keyof ImportedLot> = {
  title: "title",
  name: "title",
  player: "title",
  start_price: "start_price",
  base_price: "start_price",
  price: "start_price",
  buy_now_price: "buy_now_price",
  buy_now: "buy_now_price",
  reserve_price: "reserve_price",
  reserve: "reserve_price",
  description: "description",
};

const num = (s: string | undefined) => {
  if (s == null || s.trim() === "") return null;
  const n = Number(s.replace(/[,₹$\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Converts CSV rows (first row = headers) into lots. Known columns map to lot
 * fields; every other column becomes a custom detail (e.g. Role, Condition).
 */
export function toLots(rows: string[][]): { lots: ImportedLot[]; errors: string[] } {
  if (rows.length < 2) return { lots: [], errors: ["The file needs a header row and at least one lot."] };
  const headers = rows[0].map((h) => h.trim());
  const keys = headers.map((h) => KNOWN[h.toLowerCase().replace(/[\s-]+/g, "_")] ?? null);
  if (!keys.includes("title")) return { lots: [], errors: ['Missing a "title" (or "name"/"player") column.'] };
  if (!keys.includes("start_price")) return { lots: [], errors: ['Missing a "start_price" (or "base_price"/"price") column.'] };

  const lots: ImportedLot[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const lot: ImportedLot = { title: "", start_price: 0, buy_now_price: null, reserve_price: null, description: "", custom_fields: {} };
    headers.forEach((h, i) => {
      const v = (r[i] ?? "").trim();
      const k = keys[i];
      if (k === "title") lot.title = v.slice(0, 120);
      else if (k === "description") lot.description = v.slice(0, 5000);
      else if (k === "start_price") lot.start_price = num(v) ?? NaN;
      else if (k === "buy_now_price") lot.buy_now_price = num(v);
      else if (k === "reserve_price") lot.reserve_price = num(v);
      else if (h && v) lot.custom_fields[h.slice(0, 40)] = v.slice(0, 200);
    });
    if (!lot.title) errors.push(`Line ${line}: title is empty`);
    else if (!Number.isFinite(lot.start_price) || lot.start_price < 0) errors.push(`Line ${line}: start price is not a valid number`);
    else if (lot.buy_now_price != null && !(lot.buy_now_price > lot.start_price)) errors.push(`Line ${line}: buy now must be higher than start price`);
    else if (lot.reserve_price != null && !(lot.reserve_price > 0)) errors.push(`Line ${line}: reserve must be more than 0`);
    else lots.push(lot);
  });
  return { lots, errors };
}

export const CSV_TEMPLATE = `title,start_price,buy_now_price,reserve_price,description,Condition,Year
"Vintage camera",1000,5000,1500,"Works perfectly, with case",Used,1975
"Silver coin",250,,,,"Very good",1947
`;

export const LEAGUE_CSV_TEMPLATE = `player,base_price,Role,Country
"Player One",20000000,Batter,India
"Player Two",15000000,Bowler,Australia
`;
