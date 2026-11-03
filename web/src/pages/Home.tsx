import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase, errorMessage } from "../lib/supabase";
import type { Auction } from "../lib/types";
import { AuctionBadge } from "../components/StatusBadge";
import { Countdown } from "../components/Countdown";
import { dateTime } from "../lib/format";

type Row = Auction & { lots: { count: number }[] };

export function Home() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("auctions")
        .select("*, lots(count)")
        .in("status", ["live", "paused", "scheduled", "ended"])
        .order("starts_at", { ascending: true, nullsFirst: false })
        .limit(60);
      if (error) setError(errorMessage(error));
      setRows((data as Row[] | null) ?? []);
      setLoading(false);
    })();
  }, []);

  const live = rows.filter((a) => a.status === "live" || a.status === "paused");
  const upcoming = rows.filter((a) => a.status === "scheduled");
  const ended = rows.filter((a) => a.status === "ended").reverse().slice(0, 12);

  return (
    <div className="space-y-10">
      <section className="rounded-3xl bg-stone-900 px-6 py-10 text-white sm:px-10">
        <p className="text-sm font-semibold tracking-widest text-brand-400 uppercase">Live auctions</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
          Bid in real time. Chat with the room. Win the lot.
        </h1>
        <p className="mt-3 max-w-xl text-stone-300">
          Join a live auction, or host your own with photos, video and a live stream.
        </p>
        <Link to="/host" className="btn-accent mt-6">
          Host an auction
        </Link>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-stone-500">Loading auctions...</p>}

      <AuctionGrid title="Live now" rows={live} empty="No auctions are live right now." />
      <AuctionGrid title="Upcoming" rows={upcoming} empty="Nothing scheduled yet." />
      {ended.length > 0 && <AuctionGrid title="Recently ended" rows={ended} empty="" />}
    </div>
  );
}

function AuctionGrid({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <Link key={a.id} to={`/a/${a.id}`} className="card group overflow-hidden transition hover:shadow-lg">
              <div className="aspect-[16/9] bg-stone-100">
                {a.cover_url ? (
                  <img src={a.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-4xl text-stone-300">#</div>
                )}
              </div>
              <div className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <AuctionBadge status={a.status} />
                  <span className="text-xs text-stone-500">{a.lots[0]?.count ?? 0} lots</span>
                </div>
                <h3 className="line-clamp-1 font-semibold group-hover:underline">{a.title}</h3>
                <p className="text-xs text-stone-500">
                  {a.status === "live" ? (
                    <>
                      Ends in <Countdown endsAt={a.ends_at} />
                    </>
                  ) : a.status === "scheduled" ? (
                    <>Starts {dateTime(a.starts_at)}</>
                  ) : (
                    <>Ended {dateTime(a.ends_at)}</>
                  )}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
