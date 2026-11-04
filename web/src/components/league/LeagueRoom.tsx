import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase, errorMessage } from "../../lib/supabase";
import { bidIncrement, minNextBid, round2 } from "../../lib/bidding";
import { dateTime, money, remaining } from "../../lib/format";
import { useServerNow } from "../../lib/clock";
import { useProfileNames } from "../../lib/profiles";
import { publicUrl } from "../../lib/media";
import { LEAGUE_DEFAULTS, TEAM_COLORS, useLeagueTeams } from "../../lib/useLeagueTeams";
import type { Auction, LeagueTeam, Lot, LotMedia } from "../../lib/types";
import { ChatPanel } from "../ChatPanel";
import { BidLog } from "../BidLog";
import { LotBadge } from "../StatusBadge";
import { TeamChip, textOn } from "./TeamChip";
import { confirmDialog } from "../../lib/confirm";
import { LeagueSetupPanel, NextSeasonButton, RtmBanner, TradesPanel } from "./LeagueExtras";

type Tab = "block" | "teams" | "players" | "board" | "trades" | "bids" | "chat";

interface Props {
  auction: Auction;
  lots: Lot[];
  media: Map<string, LotMedia[]>;
  userId: string | null;
  isHost: boolean;
  isStaff: boolean;
}

export function LeagueRoom({ auction, lots, media, userId, isHost, isStaff }: Props) {
  const { teams } = useLeagueTeams(auction.id, true);
  const [tab, setTab] = useState<Tab>("block");
  const league = { ...LEAGUE_DEFAULTS, ...auction.settings.league };
  const myTeam = teams.find((t) => t.owner_id === userId) ?? null;
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  const tabs: { key: Tab; label: string; mobileOnly?: boolean }[] = [
    { key: "block", label: "Auction" },
    { key: "teams", label: `Teams (${teams.length})` },
    { key: "players", label: `Players (${lots.length})` },
    { key: "board", label: "Leaderboard" },
    ...(auction.status === "paused" || auction.status === "ended" ? [{ key: "trades" as Tab, label: "Trades" }] : []),
    { key: "bids", label: "Bid log" },
    { key: "chat", label: "Chat", mobileOnly: true },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-5">
        <JoinOrMyTeam auction={auction} myTeam={myTeam} teams={teams} isHost={isHost} league={league} />

        <div className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="inline-flex gap-1 rounded-full bg-stone-200/60 p-1">
            {tabs.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? "tab-active" : ""} ${t.mobileOnly ? "lg:hidden" : ""}`} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === "block" && <RtmBanner auction={auction} lots={lots} teamById={teamById} myTeam={myTeam} />}
        {tab === "block" && <OnTheBlock auction={auction} lots={lots} media={media} myTeam={myTeam} teamById={teamById} league={league} isHost={isHost} />}
        {tab === "block" && isHost && auction.status === "ended" && <NextSeasonButton auction={auction} />}
        {tab === "players" && isHost && (auction.status === "draft" || auction.status === "scheduled") && <LeagueSetupPanel auction={auction} lots={lots} teams={teams} />}
        {tab === "trades" && <TradesPanel auction={auction} lots={lots} teams={teams} myTeam={myTeam} isHost={isHost} />}
        {tab === "teams" && <TeamsPanel auction={auction} lots={lots} teams={teams} league={league} isHost={isHost} userId={userId} />}
        {tab === "players" && <PlayersPanel auction={auction} lots={lots} teamById={teamById} isHost={isHost} />}
        {tab === "board" && <Leaderboard auction={auction} lots={lots} teams={teams} />}
        {tab === "bids" && <BidLog auction={auction} lots={lots} userId={userId} />}
        {tab === "chat" && (
          <div className="lg:hidden">
            <ChatPanel auction={auction} userId={userId} isStaff={isStaff} />
          </div>
        )}
      </div>
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <ChatPanel auction={auction} userId={userId} isStaff={isStaff} />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Join / my team
// ---------------------------------------------------------------------------
function JoinOrMyTeam({
  auction,
  myTeam,
  teams,
  isHost,
  league,
}: {
  auction: Auction;
  myTeam: LeagueTeam | null;
  teams: LeagueTeam[];
  isHost: boolean;
  league: typeof LEAGUE_DEFAULTS;
}) {
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  const [color, setColor] = useState(TEAM_COLORS[teams.length % TEAM_COLORS.length]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shareUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
  const telegram = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(`Join my auction league "${auction.title}" on AuctionHub`)}`;

  const autoShort = (n: string) =>
    n
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 4);

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("join_league", { p_auction_id: auction.id, p_name: name.trim(), p_short_name: (short || autoShort(name)).padEnd(2, "X"), p_color: color });
    setBusy(false);
    if (error) setError(errorMessage(error));
  }

  async function leave() {
    if (!(await confirmDialog({ title: "Leave the league?", body: "Your team will be deleted.", confirmLabel: "Leave league", danger: true }))) return;
    const { error } = await supabase.rpc("leave_league", { p_auction_id: auction.id });
    if (error) setError(errorMessage(error));
  }

  const ShareRow = (
    <div className="flex flex-wrap gap-2">
      <a href={telegram} target="_blank" rel="noreferrer" className="btn border border-sky-200 bg-sky-50 py-1.5 text-sky-800 hover:bg-sky-100">
        Share to Telegram
      </a>
      <button className="btn-ghost py-1.5" onClick={() => void navigator.clipboard?.writeText(shareUrl)}>
        Copy link
      </button>
    </div>
  );

  if (myTeam) {
    return (
      <div className="card flex flex-wrap items-center gap-4 p-4" style={{ borderLeft: `6px solid ${myTeam.color}` }}>
        <TeamChip team={myTeam} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-stone-500">Your team</p>
          <p className="truncate font-display text-lg font-bold">{myTeam.name}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-stone-500">Purse left</p>
          <p className="font-display text-xl font-extrabold tabular-nums">{money(myTeam.purse_left, auction.settings)}</p>
        </div>
        {auction.status === "scheduled" && (
          <button className="text-sm text-stone-500 hover:text-red-600" onClick={() => void leave()}>
            Leave
          </button>
        )}
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (auction.status === "draft") {
    return isHost ? (
      <div className="card bg-brand-50 p-4 text-sm text-brand-700">
        Teams can join once you <strong>schedule</strong> the league (Edit, set a start time, then Schedule). You can still go live early.
      </div>
    ) : null;
  }

  if (auction.status !== "scheduled") return null;

  const canJoin = !isHost || league.host_can_play;
  const full = teams.length >= league.max_teams;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Join the league</h2>
          <p className="text-sm text-stone-500">
            {teams.length}/{league.max_teams} teams · purse {money(league.purse, auction.settings)} · squad up to {league.squad_max}
            {auction.starts_at && <> · starts {dateTime(auction.starts_at)}</>}
          </p>
        </div>
        {ShareRow}
      </div>
      {canJoin && !full ? (
        <form onSubmit={join} className="grid gap-3 sm:grid-cols-[1fr_7rem_auto]">
          <div>
            <label className="label">Team name</label>
            <input className="input" required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mumbai Mavericks" />
          </div>
          <div>
            <label className="label">Short</label>
            <input
              className="input uppercase"
              maxLength={4}
              pattern="[A-Za-z0-9]{2,4}"
              placeholder={autoShort(name) || "MM"}
              value={short}
              onChange={(e) => setShort(e.target.value.toUpperCase())}
            />
          </div>
          <div className="flex items-end">
            <button className="btn-accent w-full" disabled={busy}>
              Join
            </button>
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            {TEAM_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                className={`h-7 w-7 rounded-full border-2 ${color === c ? "border-stone-900" : "border-white"}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </form>
      ) : (
        <p className="text-sm text-stone-500">{full ? "The league is full." : "You're hosting. Share the link so teams can join."}</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// On the block
// ---------------------------------------------------------------------------
function OnTheBlock({
  auction,
  lots,
  media,
  myTeam,
  teamById,
  league,
  isHost,
}: {
  auction: Auction;
  lots: Lot[];
  media: Map<string, LotMedia[]>;
  myTeam: LeagueTeam | null;
  teamById: Map<string, LeagueTeam>;
  league: typeof LEAGUE_DEFAULTS;
  isHost: boolean;
}) {
  const now = useServerNow(200);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const ticked = useRef<string>("");
  const s = auction.settings;

  const current = lots.find((l) => l.status === "open");
  const [feedbackLot, setFeedbackLot] = useState<string | undefined>(current?.id);
  if (feedbackLot !== current?.id) {
    setFeedbackLot(current?.id);
    setFeedback(null);
  }
  const upNext = lots.filter((l) => l.status === "pending").sort((a, b) => a.position - b.position);
  const lastClosed = lots
    .filter((l) => l.status === "sold" || l.status === "unsold")
    .sort((a, b) => new Date(b.ends_at ?? 0).getTime() - new Date(a.ends_at ?? 0).getTime())[0];

  const opensIn = current?.opens_at ? new Date(current.opens_at).getTime() - now : 0;
  const endsIn = current?.ends_at ? new Date(current.ends_at).getTime() - now : 0;
  const waiting = opensIn > 0;

  // When the timer runs out, ask the server to close this player and bring up the next.
  useEffect(() => {
    if (auction.status !== "live" || !current?.ends_at) return;
    const key = `${current.id}:${current.ends_at}`;
    if (endsIn <= 0 && ticked.current !== key) {
      ticked.current = key;
      void supabase.rpc("league_tick", { p_auction_id: auction.id });
    }
  }, [endsIn, current?.id, current?.ends_at, auction.status, auction.id]);

  if (auction.status === "scheduled" || auction.status === "draft") {
    return (
      <div className="card p-8 text-center">
        <p className="font-display text-2xl font-bold">The auction hasn't started</p>
        <p className="mt-1 text-sm text-stone-500">{auction.starts_at ? `Starts ${dateTime(auction.starts_at)}` : "The host will start it soon."}</p>
        <p className="mt-4 text-sm text-stone-500">{upNext.length} players in the pool</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="card p-8 text-center">
        <p className="font-display text-2xl font-bold">{auction.status === "ended" ? "Auction complete" : "Waiting for the next player..."}</p>
        <p className="mt-1 text-sm text-stone-500">Check the Teams and Leaderboard tabs for final squads.</p>
      </div>
    );
  }

  const leader = current.winner_team_id ? teamById.get(current.winner_team_id) : undefined;
  const minBid = minNextBid(current, s);
  const step = bidIncrement(Number(current.current_bid ?? current.start_price), s);
  const squad = myTeam ? lots.filter((l) => l.winner_team_id === myTeam.id && l.status === "sold").length : 0;
  const reserveNeed = Math.max(league.squad_min - squad - 1, 0) * league.min_base;
  const maxAllowed = myTeam ? Number(myTeam.purse_left) - reserveNeed : 0;
  const options = current.current_bid == null ? [minBid, round2(minBid + step), round2(minBid + step * 3)] : [minBid, round2(minBid + step), round2(minBid + step * 3)];
  const iLead = myTeam && current.winner_team_id === myTeam.id;
  const cover = media.get(current.id)?.find((m) => m.kind === "image");
  const total = league.lot_seconds * 1000;
  const pct = waiting ? 100 : Math.max(0, Math.min(100, (endsIn / Math.max(total, league.bid_seconds * 1000)) * 100));

  async function bid(amount: number) {
    setBusy(true);
    setFeedback(null);
    const { error } = await supabase.rpc("league_bid", { p_lot_id: current!.id, p_amount: amount });
    setBusy(false);
    setFeedback(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: `Bid placed: ${money(amount, s)}` });
  }

  async function hostClose() {
    const { error } = await supabase.rpc("close_lot_now", { p_lot_id: current!.id });
    if (error) setFeedback({ ok: false, text: errorMessage(error) });
  }

  return (
    <div className="space-y-4">
      {lastClosed && (
        <div className="flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm text-white">
          <span className="text-stone-500">Last:</span>
          <span className="truncate font-semibold">{lastClosed.title}</span>
          {lastClosed.status === "sold" && lastClosed.winner_team_id && teamById.get(lastClosed.winner_team_id) ? (
            <>
              <span className="text-stone-500">sold to</span>
              <TeamChip team={teamById.get(lastClosed.winner_team_id)!} />
              <span className="ml-auto font-bold tabular-nums text-brand-300">{money(lastClosed.current_bid, s)}</span>
            </>
          ) : (
            <span className="ml-auto text-stone-500">unsold</span>
          )}
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-3xl p-5 text-snow sm:p-7"
        style={{ background: leader ? `linear-gradient(135deg, #0c0a09 40%, ${leader.color})` : "linear-gradient(135deg, #0c0a09 50%, #44403c)" }}
      >
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="h-40 w-full shrink-0 overflow-hidden rounded-2xl bg-snow/10 sm:h-44 sm:w-44">
            {cover ? (
              <img src={publicUrl("lot-media", cover.path)} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center font-display text-5xl font-extrabold text-snow/30">#{current.position + 1}</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-widest text-brand-300 uppercase">{waiting ? "Up next" : "On the block"}</p>
            <h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight">{current.title}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(current.custom_fields ?? {}).map(([k, v]) => (
                <span key={k} className="chip bg-snow/10 text-snow/90">
                  {k}: {v}
                </span>
              ))}
              <span className="chip bg-snow/10 text-snow/90">Base {money(current.start_price, s)}</span>
            </div>
            <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-2">
              <div>
                <p className="text-xs text-snow/60">{current.current_bid == null ? "No bids yet" : "Current bid"}</p>
                <p key={String(current.current_bid)} className="animate-flash rounded-lg font-display text-4xl font-extrabold tabular-nums sm:text-5xl">
                  {money(current.current_bid ?? current.start_price, s)}
                </p>
              </div>
              {leader && (
                <div className="flex items-center gap-2 pb-1">
                  <TeamChip team={leader} size="lg" />
                  <span className="text-sm font-semibold">{leader.name}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-row items-center gap-3 sm:flex-col sm:items-end">
            <p className={`font-mono text-5xl font-bold tabular-nums ${!waiting && endsIn < 5000 ? "text-red-400" : ""}`}>
              {waiting ? remaining(opensIn) : remaining(endsIn)}
            </p>
            <p className="text-xs text-snow/60">{waiting ? "until bidding opens" : "left"}</p>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-snow/10">
          <div className="h-full bg-brand-400 transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {myTeam && auction.status === "live" && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <TeamChip team={myTeam} />
            <span>
              Purse <strong className="tabular-nums">{money(myTeam.purse_left, s)}</strong>
            </span>
            <span>
              Squad <strong>{squad}</strong>/{league.squad_max}
            </span>
            {reserveNeed > 0 && <span className="text-stone-500">Max bid {money(maxAllowed, s)}</span>}
          </div>
          {iLead ? (
            <p className="rounded-xl bg-emerald-50 px-3 py-3 text-center font-semibold text-emerald-800">Your team has the highest bid</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {options.map((amt, i) => (
                <button
                  key={amt}
                  className={`${i === 0 ? "btn-accent" : "btn-ghost"} py-3 text-base`}
                  disabled={busy || waiting || amt > maxAllowed || squad >= league.squad_max}
                  onClick={() => void bid(amt)}
                >
                  {money(amt, s)}
                </button>
              ))}
            </div>
          )}
          {feedback && <p className={`text-sm font-medium ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.text}</p>}
        </div>
      )}

      {!myTeam && !isHost && auction.status === "live" && (
        <p className="card p-4 text-center text-sm text-stone-500">You're watching. Teams joined before the auction started.</p>
      )}

      {isHost && auction.status === "live" && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => void hostClose()}>
            {current.current_bid != null ? "Sold! Close now" : "Skip (unsold)"}
          </button>
          {feedback && !myTeam && <p className={`text-sm ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.text}</p>}
        </div>
      )}

      {upNext.length > 0 && (
        <div className="card p-4">
          <p className="mb-2 text-xs font-semibold tracking-wider text-stone-500 uppercase">Up next</p>
          <div className="scrollbar-none flex gap-2 overflow-x-auto">
            {upNext.slice(0, 12).map((l) => (
              <span key={l.id} className="chip shrink-0 bg-stone-100 py-1 text-stone-700">
                #{l.position + 1} {l.title} · {money(l.start_price, s)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
function TeamsPanel({
  auction,
  lots,
  teams,
  league,
  isHost,
  userId,
}: {
  auction: Auction;
  lots: Lot[];
  teams: LeagueTeam[];
  league: typeof LEAGUE_DEFAULTS;
  isHost: boolean;
  userId: string | null;
}) {
  const owners = useProfileNames(teams.map((t) => t.owner_id));
  const s = auction.settings;
  if (teams.length === 0) return <div className="card py-14 text-center text-sm text-stone-500">No teams yet.</div>;

  async function remove(t: LeagueTeam) {
    if (!(await confirmDialog({ title: `Remove ${t.name}?`, body: "The team leaves the league.", confirmLabel: "Remove team", danger: true }))) return;
    await supabase.rpc("remove_league_team", { p_team_id: t.id });
  }

  return (
    <div className="grid animate-rise gap-4 md:grid-cols-2">
      {teams.map((t) => {
        const roster = lots.filter((l) => l.winner_team_id === t.id && l.status === "sold").sort((a, b) => Number(b.current_bid) - Number(a.current_bid));
        const spent = roster.reduce((n, l) => n + Number(l.current_bid), 0);
        const pct = (Number(t.purse_left) / league.purse) * 100;
        return (
          <div key={t.id} className="card overflow-hidden">
            <div className="flex items-center gap-3 p-4" style={{ background: t.color, color: textOn(t.color) }}>
              <span className="font-display text-2xl font-extrabold">{t.short_name}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{t.name}</p>
                <p className="truncate text-xs opacity-80">{t.owner_id === userId ? "You" : (owners.get(t.owner_id) ?? "...")}</p>
              </div>
              {isHost && auction.status === "scheduled" && (
                <button className="rounded-lg bg-black/20 px-2 py-1 text-xs" onClick={() => void remove(t)}>
                  Remove
                </button>
              )}
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div>
                  <p className="text-[11px] text-stone-500 uppercase">Purse left</p>
                  <p className="font-bold tabular-nums">{money(t.purse_left, s)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-stone-500 uppercase">Spent</p>
                  <p className="font-bold tabular-nums">{money(spent, s)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-stone-500 uppercase">Squad</p>
                  <p className="font-bold">
                    {roster.length}/{league.squad_max}
                  </p>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: t.color }} />
              </div>
              {roster.length > 0 ? (
                <ul className="divide-y divide-stone-100 text-sm">
                  {roster.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="truncate">{l.title}</span>
                      <span className="shrink-0 tabular-nums text-stone-600">{money(l.current_bid, s)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone-500">No players yet.</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
function PlayersPanel({ auction, lots, teamById, isHost }: { auction: Auction; lots: Lot[]; teamById: Map<string, LeagueTeam>; isHost: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const s = auction.settings;
  const groups: { title: string; rows: Lot[] }[] = [
    { title: "On the block", rows: lots.filter((l) => l.status === "open") },
    { title: "Upcoming", rows: lots.filter((l) => l.status === "pending") },
    { title: "Sold", rows: lots.filter((l) => l.status === "sold") },
    { title: "Unsold", rows: lots.filter((l) => l.status === "unsold" || l.status === "withdrawn") },
  ];
  const unsold = lots.filter((l) => l.status === "unsold").length;

  async function requeue() {
    const { data, error } = await supabase.rpc("league_requeue_unsold", { p_auction_id: auction.id });
    setError(error ? errorMessage(error) : `${data} players are back in the pool`);
  }

  async function points(lot: Lot, value: string) {
    const n = value.trim() === "" ? null : Number(value);
    if (n != null && !Number.isFinite(n)) return;
    const { error } = await supabase.rpc("set_lot_points", { p_lot_id: lot.id, p_points: n });
    if (error) setError(errorMessage(error));
  }

  return (
    <div className="animate-rise space-y-4">
      {isHost && unsold > 0 && ["live", "paused", "ended"].includes(auction.status) && (
        <div className="card flex flex-wrap items-center gap-3 p-4">
          <p className="flex-1 text-sm">{unsold} unsold players</p>
          <button className="btn-accent" onClick={() => void requeue()}>
            Re-auction unsold
          </button>
        </div>
      )}
      {error && <p className="text-sm text-stone-600">{error}</p>}
      {isHost && <p className="text-xs text-stone-500">Enter points for sold players (e.g. match performance). The leaderboard ranks teams by total points.</p>}
      {groups
        .filter((g) => g.rows.length > 0)
        .map((g) => (
          <div key={g.title} className="card overflow-hidden">
            <p className="border-b border-stone-100 px-4 py-2.5 text-xs font-semibold tracking-wider text-stone-500 uppercase">
              {g.title} ({g.rows.length})
            </p>
            <ul className="divide-y divide-stone-100">
              {g.rows.map((l) => {
                const team = l.winner_team_id ? teamById.get(l.winner_team_id) : undefined;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="w-8 font-mono text-xs text-stone-500">#{l.position + 1}</span>
                    <div className="min-w-[8rem] flex-1">
                      <p className="truncate font-medium">{l.title}</p>
                      <p className="truncate text-xs text-stone-500">
                        Base {money(l.start_price, s)}
                        {Object.values(l.custom_fields ?? {}).length > 0 && ` · ${Object.values(l.custom_fields).join(" · ")}`}
                      </p>
                    </div>
                    {team && <TeamChip team={team} />}
                    {l.current_bid != null && <span className="font-semibold tabular-nums">{money(l.current_bid, s)}</span>}
                    {l.status === "sold" &&
                      (isHost ? (
                        <input
                          className="input w-20 py-1 text-right"
                          type="number"
                          step="0.5"
                          placeholder="pts"
                          defaultValue={l.points ?? ""}
                          onBlur={(e) => void points(l, e.target.value)}
                        />
                      ) : (
                        l.points != null && <span className="chip bg-brand-100 text-brand-700">{l.points} pts</span>
                      ))}
                    {l.status !== "sold" && <LotBadge status={l.status} />}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
function Leaderboard({ auction, lots, teams }: { auction: Auction; lots: Lot[]; teams: LeagueTeam[] }) {
  const s = auction.settings;
  const rows = teams
    .map((t) => {
      const roster = lots.filter((l) => l.winner_team_id === t.id && l.status === "sold");
      return {
        team: t,
        players: roster.length,
        points: roster.reduce((n, l) => n + Number(l.points ?? 0), 0),
        spent: roster.reduce((n, l) => n + Number(l.current_bid ?? 0), 0),
      };
    })
    .sort((a, b) => b.points - a.points || Number(b.team.purse_left) - Number(a.team.purse_left));
  const medals = ["bg-brand-400 text-ink", "bg-stone-300 text-ink", "bg-orange-300 text-ink"];

  if (rows.length === 0) return <div className="card py-14 text-center text-sm text-stone-500">No teams yet.</div>;

  return (
    <div className="card animate-rise overflow-hidden">
      <div className="grid grid-cols-[2.5rem_1fr_4rem_5rem] gap-2 border-b border-stone-100 px-4 py-2.5 text-[11px] font-semibold tracking-wider text-stone-500 uppercase sm:grid-cols-[2.5rem_1fr_4rem_5rem_7rem_7rem]">
        <span>#</span>
        <span>Team</span>
        <span className="text-right">Squad</span>
        <span className="text-right">Points</span>
        <span className="hidden text-right sm:block">Spent</span>
        <span className="hidden text-right sm:block">Purse left</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.team.id}
          className="grid grid-cols-[2.5rem_1fr_4rem_5rem] items-center gap-2 border-b border-stone-100 px-4 py-3 last:border-0 sm:grid-cols-[2.5rem_1fr_4rem_5rem_7rem_7rem]"
        >
          <span className={`flex h-8 w-8 items-center justify-center rounded-full font-display text-sm font-extrabold ${medals[i] ?? "text-stone-500"}`}>{i + 1}</span>
          <span className="flex min-w-0 items-center gap-2">
            <TeamChip team={r.team} />
            <span className="truncate font-semibold">{r.team.name}</span>
          </span>
          <span className="text-right tabular-nums">{r.players}</span>
          <span className="text-right font-display text-lg font-extrabold tabular-nums">{r.points}</span>
          <span className="hidden text-right text-sm tabular-nums sm:block">{money(r.spent, s)}</span>
          <span className="hidden text-right text-sm tabular-nums sm:block">{money(r.team.purse_left, s)}</span>
        </div>
      ))}
      <p className="px-4 py-3 text-xs text-stone-500">
        Ranked by total player points (set by the host), then purse left.{" "}
        <Link to="/terms" className="underline">
          Virtual points only, no real money.
        </Link>
      </p>
    </div>
  );
}
