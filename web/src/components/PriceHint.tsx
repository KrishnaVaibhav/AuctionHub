import { useEffect, useState } from "react";
import { LightbulbIcon } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/format";
import type { AuctionSettings } from "../lib/types";

interface Hint {
  count: number;
  low: number;
  median: number;
  high: number;
  similar: boolean;
}

/** "Similar lots sold for X to Y" from public sales in the same category over the last year. */
export function PriceHint({ category, title, settings, className = "" }: { category: string | null; title?: string; settings: AuctionSettings; className?: string }) {
  const [hint, setHint] = useState<Hint | null>(null);
  useEffect(() => {
    if (!category) return;
    const t = setTimeout(() => {
      void supabase
        .rpc("price_hint", { p_category: category, p_currency: settings.currency ?? "INR", p_title: title?.trim() || null })
        .then(({ data }) => setHint((data as Hint | null) ?? null));
    }, 300);
    return () => clearTimeout(t);
  }, [category, title, settings.currency]);

  if (!category || !hint) return null;
  return (
    <p className={`flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800 ${className}`}>
      <LightbulbIcon size={16} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>
        {hint.similar ? "Similar lots" : "Lots in this category"} sold for {money(hint.low, settings)} to {money(hint.high, settings)} (median{" "}
        {money(hint.median, settings)}, {hint.count} sales this year).
      </span>
    </p>
  );
}
