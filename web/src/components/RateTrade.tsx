import { StarIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { supabase, errorMessage } from "../lib/supabase";

/** Star rating for a completed sale. The buyer rates the seller; the host rates the buyer. */
export function RateTrade({ lotId, userId, label }: { lotId: string; userId: string; label: string }) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from("ratings")
      .select("stars, comment")
      .eq("lot_id", lotId)
      .eq("rater_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setStars(data.stars);
          setComment(data.comment ?? "");
          setSaved(true);
        }
      });
  }, [lotId, userId]);

  async function save() {
    setError(null);
    const { error } = await supabase.rpc("rate_trade", { p_lot_id: lotId, p_stars: stars, p_comment: comment || null });
    if (error) setError(errorMessage(error));
    else {
      setSaved(true);
      setOpen(false);
    }
  }

  const Stars = (
    <span className="inline-flex" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={`px-0.5 text-lg leading-none ${(hover || stars) >= n ? "text-brand-500" : "text-stone-300"}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => {
            setStars(n);
            setOpen(true);
          }}
        >
          <StarIcon size={18} weight="fill" aria-hidden="true" />
        </button>
      ))}
    </span>
  );

  return (
    <div className="space-y-2 text-xs" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-stone-500">{saved && !open ? `Your rating of the ${label}:` : `Rate the ${label}:`}</span>
        {Stars}
      </div>
      {open && (
        <div className="flex gap-2">
          <input className="input py-1.5 text-xs" maxLength={500} placeholder="Optional comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-primary py-1 text-xs" disabled={!stars} onClick={() => void save()}>
            Save
          </button>
        </div>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
