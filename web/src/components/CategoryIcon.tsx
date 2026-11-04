/** Stroke icons for auction categories, drawn to match the 2px header icons. */
const paths: Record<string, string> = {
  all: "M4 6h16M4 12h16M4 18h10",
  league: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3",
  art: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.8.7-1.4 1.5-1.4H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8ZM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01",
  collectibles: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8L3.5 9.2l5.9-.9L12 3Z",
  coins: "M9 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM18.1 10.4a6 6 0 1 1-7.7 7.7M7 6h2v4",
  electronics: "M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  fashion: "M6 8h12l1 13H5L6 8ZM9 8V6a3 3 0 0 1 6 0v2",
  jewellery: "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 9v3l2 1M9 6l1-4h4l1 4M9 18l1 4h4l1-4",
  vehicles: "M5 17a3 3 0 1 0 0-.01M19 17a3 3 0 1 0 0-.01M5 17h1l4-6h5l4 6M10 11 8 7H5M15 11l1-4h3",
  home: "M4 18v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6M2 14h20v4H2v-4ZM6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3M5 18v2M19 18v2",
  sports: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6c2.6 2.6 2.6 10.2 0 12.8M18.4 5.6c-2.6 2.6-2.6 10.2 0 12.8",
  books: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5",
  charity: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  other: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
};

export function CategoryIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const d = paths[name];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
