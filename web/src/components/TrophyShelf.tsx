import { useEffect, useState } from "react";
import { Link } from "react-router";
import { TrophyIcon } from "@phosphor-icons/react";
import { supabase } from "../lib/supabase";
import { money } from "../lib/format";
import { publicUrl } from "../lib/media";
import { t } from "../lib/i18n";

interface Trophy {
  lot_id: string;
  title: string;
  auction_id: string;
  price: number;
  currency: string;
  cover: string | null;
  won_at: string | null;
}

/** Lots someone won in public auctions, shown only if they opted in (or to themselves). */
export function TrophyShelf({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Trophy[] | null>(null);
  useEffect(() => {
    void supabase.rpc("trophy_shelf", { p_user_id: userId }).then(({ data }) => setRows((data as Trophy[] | null) ?? []));
  }, [userId]);
  if (!rows || rows.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="section-title flex items-center gap-2">
        <TrophyIcon size={20} weight="fill" className="text-brand-500" aria-hidden="true" /> {t("Trophy shelf")}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6 3xl:grid-cols-8">
        {rows.map((r, i) => (
          <Link key={r.lot_id} to={`/a/${r.auction_id}`} className="card card-hover reveal group overflow-hidden" style={{ ["--i" as string]: i }}>
            <div className="aspect-square bg-stone-100">
              {r.cover ? (
                <img src={publicUrl("lot-media", r.cover)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-700 group-hover:scale-110" />
              ) : (
                <div className="flex h-full items-center justify-center text-stone-400">
                  <TrophyIcon size={32} aria-hidden="true" />
                </div>
              )}
            </div>
            <div className="p-2.5">
              <p className="truncate text-sm font-semibold">{r.title}</p>
              <p className="text-xs text-stone-500 tabular-nums">{money(r.price, { currency: r.currency })}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
