import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { Link, useParams } from "react-router";
import { LinkSimpleIcon, TrophyIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../lib/supabase";
import { TeamChip } from "../components/league/TeamChip";
import { shareCard } from "../lib/shareCard";

interface SeasonRow {
  auction_id: string;
  title: string;
  status: string;
  season: number;
}
interface FranchiseRow {
  franchise_id: string;
  name: string;
  short_name: string;
  color: string;
  total: number;
  matches: number;
  by_season: Record<string, number>;
}
interface TableData {
  seasons: SeasonRow[];
  teams: FranchiseRow[];
  players: { title: string; points: number; team: string | null }[];
}

const medal = ["bg-brand-400 text-ink", "bg-stone-300 text-ink", "bg-orange-300 text-ink"];

/** Public league table across every season of a series. */
export function SeasonTable() {
  const { id } = useParams();
  const [data, setData] = useState<TableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    void supabase.rpc("league_season_table", { p_auction_id: id }).then(({ data, error }) => {
      if (error) setError(errorMessage(error));
      else setData(data as TableData);
    });
  }, [id]);

  if (error) return <div className="card mx-auto max-w-md p-8 text-center text-sm text-stone-500">{error}</div>;
  if (!data) return <div className="h-72 animate-pulse rounded-[32px] bg-stone-900/[0.05]" />;

  const latest = data.seasons[data.seasons.length - 1];
  const series = (latest?.title ?? "League").replace(/\s*·\s*Season \d+$/, "");

  return (
    <div className="space-y-6">
      <header className="aurora flex flex-wrap items-end justify-between gap-4 rounded-[32px] border border-white/60 p-6 sm:p-8 dark:border-white/[0.06]">
        <div className="enter min-w-0">
          <span className="glass chip px-3 py-1 text-stone-700">
            <TrophyIcon size={14} weight="fill" aria-hidden="true" /> Season table
          </span>
          <h1 className="page-title mt-3">{series}</h1>
          <p className="page-sub">
            {t(data.seasons.length === 1 ? "{n} season" : "{n} seasons", { n: data.seasons.length })} ·{" "}
            {t("Fantasy points from recorded matches, or the host's player points where no matches were recorded. Virtual points only.")}
          </p>
        </div>
        <div className="enter flex gap-2" style={{ ["--i" as string]: 1 }}>
          {latest && (
            <Link to={`/a/${latest.auction_id}`} className="btn-glass">
              {t("Open latest season")}
            </Link>
          )}
          <button
            className="btn-accent"
            onClick={() => {
              void navigator.clipboard?.writeText(window.location.href);
              setCopied(true);
            }}
          >
            <LinkSimpleIcon size={16} weight="bold" aria-hidden="true" />
            {copied ? t("Link copied") : t("Share")}
          </button>
        </div>
      </header>

      {data.teams[0] && (
        <button
          className="btn-ghost"
          onClick={() =>
            void shareCard({ eyebrow: t("Leading the table"), headline: data.teams[0].name, big: `${data.teams[0].total} pts`, footer: series, accent: data.teams[0].color }, "auctionhub-season.png")
          }
        >
          {t("Share the leader card")}
        </button>
      )}

      {data.teams.length === 0 ? (
        <div className="card py-14 text-center text-sm text-stone-500">{t("No teams yet.")}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table w-full min-w-[28rem] text-sm">
            <thead className="text-left text-[11px] tracking-wider text-stone-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">{t("Team")}</th>
                {data.seasons.map((s) => (
                  <th key={s.auction_id} className="px-4 py-2.5 text-right">
                    <Link to={`/a/${s.auction_id}`} className="hover:text-stone-900">
                      S{s.season}
                    </Link>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-right">{t("Total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-900/[0.06]">
              {data.teams.map((t, i) => (
                <tr key={t.franchise_id} className="enter" style={{ ["--i" as string]: Math.min(i, 8) }}>
                  <td className="px-4 py-3">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full font-display text-sm font-extrabold ${medal[i] ?? "text-stone-500"}`}>{i + 1}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <TeamChip team={t} />
                      <span className="truncate font-semibold">{t.name}</span>
                    </span>
                  </td>
                  {data.seasons.map((s) => (
                    <td key={s.auction_id} className="px-4 py-3 text-right text-stone-600 tabular-nums">
                      {t.by_season[s.auction_id] ?? "-"}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-display text-lg font-extrabold tabular-nums">{t.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.players.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title px-1">{t("Top players")}</h2>
          <div className="group-list">
            {data.players.map((p, i) => (
              <div key={p.title} className="group-row">
                <span className="w-6 text-center font-display font-extrabold text-stone-500 tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                {p.team && <span className="chip bg-stone-900/[0.05] text-stone-600">{p.team}</span>}
                <span className="w-16 text-right font-display font-extrabold tabular-nums">{p.points}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
