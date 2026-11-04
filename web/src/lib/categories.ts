export const CATEGORIES = [
  ["art", "Art"],
  ["collectibles", "Collectibles"],
  ["coins", "Coins & Stamps"],
  ["electronics", "Electronics"],
  ["fashion", "Fashion"],
  ["jewellery", "Jewellery & Watches"],
  ["vehicles", "Vehicles"],
  ["home", "Home & Furniture"],
  ["sports", "Sports"],
  ["books", "Books"],
  ["charity", "Charity"],
  ["other", "Other"],
] as const;

export type Category = (typeof CATEGORIES)[number][0];

export const categoryLabel = (c: string | null | undefined): string => CATEGORIES.find(([k]) => k === c)?.[1] ?? "";

/** "silver, India ,coins" -> ["silver","india","coins"] (max 8, 24 chars each). */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "").slice(0, 24)).filter(Boolean))].slice(0, 8);
}
