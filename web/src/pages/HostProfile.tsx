import { StarIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { supabase } from "../lib/supabase";
import { dateTime } from "../lib/format";
import { categoryLabel } from "../lib/categories";
import { CategoryIcon } from "../components/CategoryIcon";
import type { Auction } from "../lib/types";
import { Avatar } from "../components/Avatar";
import { AuctionBadge } from "../components/StatusBadge";
import { FollowButton } from "../components/FollowButton";
import { NotFound } from "./NotFound";
import { TrophyShelf } from "../components/TrophyShelf";
import { BadgeGrid } from "../components/Progress";
import { useBadges, useEventTitles } from "../lib/progress";
import { TIER_STYLE, useHostTiers } from "../lib/hostTiers";

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
            <StarIcon className="inline text-brand-500" size="0.9em" weight="fill" aria-hidden="true" /> {Number(avg).toFixed(1)} <span className="text-sm font-normal text-stone-500">({count})</span>
          </>
        ) : (
          <span className="text-sm font-normal text-stone-500">No ratings yet</span>
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
      <div className="aurora flex flex-wrap items-center gap-5 rounded-[32px] border border-white/60 p-6 sm:p-8 dark:border-snow/[0.06]">
        <Avatar name={profile.display_name} url={profile.avatar_url} size={88} />
        <div className="min-w-0 flex-1">
          <h1 className="page-title">{profile.display_name}</h1>
          <TierChip hostId={profile.id} />
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

      <ProfileExtras userId={profile.id} />

      <AuctionList title="Live and upcoming" rows={active} empty="Nothing live or scheduled right now." />
      <AuctionList title="Past auctions" rows={past} empty="No past auctions." />

      {reviews.length > 0 && (
        <section>
          <h2 className="section-title mb-3">Recent reviews</h2>
          <div className="card divide-y divide-stone-900/[0.06]">
            {reviews.map((r) => (
              <div key={r.id} className="px-4 py-3 text-sm">
                <p>
                  <span className="inline-flex" aria-label={`${r.stars} of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <StarIcon key={n} size={14} weight="fill" className={n <= r.stars ? "text-brand-500" : "text-stone-300"} aria-hidden="true" />
                    ))}
                  </span>
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
      <h2 className="section-title mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {rows.map((a) => (
            <Link key={a.id} to={`/a/${a.id}`} className="card flex gap-3 overflow-hidden p-3 card-hover">
              <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-stone-100">
                {a.cover_url && <img src={a.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </div>
              <div className="min-w-0">
                <AuctionBadge status={a.status} />
                <p className="mt-1 line-clamp-1 text-sm font-semibold">{a.title}</p>
                <p className="flex items-center gap-1 text-xs text-stone-500">
                  {a.category ? (
                    <>
                      <CategoryIcon name={a.category} className="h-3.5 w-3.5" /> {categoryLabel(a.category)}
                    </>
                  ) : a.mode === "league" ? (
                    "Team league"
                  ) : (
                    ""
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

function TierChip({ hostId }: { hostId: string }) {
  const tier = useHostTiers([hostId]).get(hostId);
  return tier ? <span className={`chip mt-1 ${TIER_STYLE[tier].cls}`}>{TIER_STYLE[tier].label}</span> : null;
}

function ProfileExtras({ userId }: { userId: string }) {
  const badges = useBadges(userId);
  const events = useEventTitles();
  return (
    <>
      {badges.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-title">Badges</h2>
          <BadgeGrid badges={badges} events={events} />
        </section>
      )}
      <TrophyShelf userId={userId} />
    </>
  );
}
