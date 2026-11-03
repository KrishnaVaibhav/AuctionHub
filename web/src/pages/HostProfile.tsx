import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { supabase } from "../lib/supabase";
import { dateTime } from "../lib/format";
import { categoryIcon, categoryLabel } from "../lib/categories";
import type { Auction } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { AuctionBadge } from "../components/StatusBadge";
import { FollowButton } from "../components/FollowButton";
import { NotFound } from "./NotFound";

interface PublicProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  joined: string;
  followers: number;
  following: number;
  auctions_hosted: number;
  lots_sold: number;
  seller_rating: { avg: number | null; count: number };
  buyer_rating: { avg: number | null; count: number };
}

interface Review {
  id: number;
  stars: number;
  comment: string | null;
  role: string;
  created_at: string;
}

function StarRow({ avg, count, label }: { avg: number | null; count: number; label: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wider text-stone-500 uppercase">{label}</p>
      <p className="mt-1 font-display text-xl font-bold">
        {count ? (
          <>
            <span className="text-brand-500">★</span> {Number(avg).toFixed(1)} <span className="text-sm font-normal text-stone-500">({count})</span>
          </>
        ) : (
          <span className="text-sm font-normal text-stone-400">No ratings yet</span>
        )}
      </p>
    </div>
  );
}

export function HostProfile() {
  const { username } = useParams();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    if (!username) return;
    void supabase.rpc("public_profile", { p_username: username }).then(async ({ data }) => {
      const p = (data as PublicProfile | null) ?? null;
      setProfile(p);
      if (!p) return;
      const [a, r] = await Promise.all([
        supabase.from("auctions").select("*").eq("host_id", p.id).eq("visibility", "public").neq("status", "draft").order("created_at", { ascending: false }).limit(50),
        supabase.from("ratings").select("id, stars, comment, role, created_at").eq("ratee_id", p.id).order("created_at", { ascending: false }).limit(20),
      ]);
      setAuctions((a.data as Auction[] | null) ?? []);
      setReviews((r.data as Review[] | null) ?? []);
    });
  }, [username]);

  if (profile === undefined) return <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />;
  if (profile === null) return <NotFound />;

  const active = auctions.filter((a) => ["live", "paused", "scheduled"].includes(a.status));
  const past = auctions.filter((a) => !["live", "paused", "scheduled"].includes(a.status));

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-4 p-6">
        <Avatar name={profile.display_name} url={profile.avatar_url} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{profile.display_name}</h1>
          <p className="text-sm text-stone-500">
            @{profile.username} · joined {new Date(profile.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
          </p>
          <p className="mt-1 text-sm">
            <strong>{profile.followers}</strong> followers · <strong>{profile.auctions_hosted}</strong> auctions · <strong>{profile.lots_sold}</strong> lots sold
          </p>
        </div>
        <FollowButton hostId={profile.id} onChange={(f) => setProfile({ ...profile, followers: profile.followers + (f ? 1 : -1) })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <StarRow label="As a seller" avg={profile.seller_rating.avg} count={profile.seller_rating.count} />
        </div>
        <div className="card p-4">
          <StarRow label="As a buyer" avg={profile.buyer_rating.avg} count={profile.buyer_rating.count} />
        </div>
      </div>

      <AuctionList title="Live and upcoming" rows={active} empty="Nothing live or scheduled right now." />
      <AuctionList title="Past auctions" rows={past} empty="No past auctions." />

      {reviews.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Recent reviews</h2>
          <div className="card divide-y divide-stone-100">
            {reviews.map((r) => (
              <div key={r.id} className="px-4 py-3 text-sm">
                <p>
                  <span className="text-brand-500">{"★".repeat(r.stars)}</span>
                  <span className="text-stone-300">{"★".repeat(5 - r.stars)}</span>
                  <span className="ml-2 text-xs text-stone-500">as {r.role} · {dateTime(r.created_at)}</span>
                </p>
                {r.comment && <p className="mt-1 text-stone-700">{r.comment}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AuctionList({ title, rows, empty }: { title: string; rows: Auction[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((a) => (
            <Link key={a.id} to={`/a/${a.id}`} className="card flex gap-3 overflow-hidden p-3 transition hover:shadow-md">
              <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                {a.cover_url && <img src={a.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0">
                <AuctionBadge status={a.status} />
                <p className="mt-1 line-clamp-1 text-sm font-semibold">{a.title}</p>
                <p className="text-xs text-stone-500">
                  {a.category ? `${categoryIcon(a.category)} ${categoryLabel(a.category)}` : a.mode === "league" ? "Team league" : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
