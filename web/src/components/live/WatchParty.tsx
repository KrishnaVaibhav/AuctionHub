import { useEffect, useRef, useState, type FormEvent } from "react";
import { CopySimpleIcon, UsersIcon } from "@phosphor-icons/react";
import { supabase, errorMessage, channelName } from "../../lib/supabase";
import { useProfileNames } from "../../lib/profiles";
import { funOn } from "../../lib/fun";
import { t } from "../../lib/i18n";
import type { Auction } from "../../lib/types";

interface Party {
  id: string;
  name: string;
  code: string;
  owner_id: string;
}
interface Msg {
  id: number;
  party_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

/** Private group chat inside this auction. Join with a code or a ?party= link. */
export function WatchParty({ auction, userId }: { auction: Auction; userId: string | null }) {
  const [parties, setParties] = useState<Party[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get("party") ?? "");
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("watch_parties").select("id, name, code, owner_id").eq("auction_id", auction.id);
    const list = (data as Party[] | null) ?? [];
    setParties(list);
    setActive((a) => a ?? list[0]?.id ?? null);
  }
  useEffect(() => {
    if (userId) void load();
  }, [auction.id, userId]);

  // Auto-join from a shared link.
  useEffect(() => {
    if (userId && code && new URLSearchParams(window.location.search).get("party") === code) void join();
  }, [userId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.rpc("create_watch_party", { p_auction_id: auction.id, p_name: name });
    if (error) return setErr(errorMessage(error));
    setName("");
    setErr(null);
    await load();
    setActive((data as { id: string }).id);
  }
  async function join(e?: FormEvent) {
    e?.preventDefault();
    const { data, error } = await supabase.rpc("join_watch_party", { p_code: code });
    if (error) return setErr(errorMessage(error));
    setCode("");
    setErr(null);
    await load();
    setActive(data as string);
  }

  if (!funOn(auction.settings, "parties")) return <p className="card p-5 text-sm text-stone-500">{t("The host has turned watch parties off.")}</p>;
  if (!userId) return <p className="card p-5 text-sm text-stone-500">{t("Sign in to start a watch party.")}</p>;
  const party = parties.find((p) => p.id === active);

  return (
    <div className="space-y-3">
      <div className="card space-y-3 p-4">
        <p className="flex items-center gap-2 font-semibold">
          <UsersIcon size={18} weight="bold" className="text-sky-600" aria-hidden="true" />
          {t("Watch party")}
        </p>
        <p className="text-xs text-stone-500">{t("A private chat for you and up to 19 friends while you watch this auction.")}</p>
        {parties.length > 1 && (
          <div className="segmented">
            {parties.map((p) => (
              <button key={p.id} className={`tab ${p.id === active ? "tab-active" : ""}`} onClick={() => setActive(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <form onSubmit={create} className="flex gap-2">
            <input className="input" required minLength={2} maxLength={40} placeholder={t("Party name")} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary shrink-0">{t("Start")}</button>
          </form>
          <form onSubmit={join} className="flex gap-2">
            <input className="input font-mono" required placeholder={t("Invite code")} value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn-ghost shrink-0">{t("Join")}</button>
          </form>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      {party && <PartyChat party={party} auctionId={auction.id} userId={userId} />}
    </div>
  );
}

function PartyChat({ party, auctionId, userId }: { party: Party; auctionId: string; userId: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const names = useProfileNames(msgs.map((m) => m.user_id));
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void supabase
      .from("watch_party_messages")
      .select("*")
      .eq("party_id", party.id)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setMsgs(((data as Msg[] | null) ?? []).reverse()));
    const ch = supabase
      .channel(channelName(`party:${party.id}`))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "watch_party_messages", filter: `party_id=eq.${party.id}` }, (p) =>
        setMsgs((m) => (m.some((x) => x.id === (p.new as Msg).id) ? m : [...m.slice(-199), p.new as Msg])),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [party.id]);
  useEffect(() => end.current?.scrollIntoView({ block: "nearest" }), [msgs.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    await supabase.from("watch_party_messages").insert({ party_id: party.id, user_id: userId, body });
  }

  const link = `${window.location.origin}/a/${auctionId}?party=${party.code}`;
  return (
    <div className="card flex h-96 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-stone-900/[0.06] px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate font-semibold">{party.name}</p>
        <button
          className="btn-ghost px-3 py-1 text-xs"
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            setCopied(true);
          }}
        >
          <CopySimpleIcon size={14} aria-hidden="true" /> {copied ? t("Copied") : t("Invite link")}
        </button>
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-3 text-sm">
        {msgs.length === 0 && <p className="text-stone-500">{t("Say hi to your party.")}</p>}
        {msgs.map((m) => (
          <p key={m.id} className={m.user_id === userId ? "text-right" : ""}>
            <span className={`inline-block max-w-[80%] rounded-2xl px-3 py-1.5 ${m.user_id === userId ? "bg-sky-500 text-snow" : "bg-stone-900/[0.05]"}`}>
              {m.user_id !== userId && <span className="mr-1.5 font-semibold">{names.get(m.user_id) ?? "..."}</span>}
              {m.body}
            </span>
          </p>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-stone-900/[0.06] p-3">
        <input className="input rounded-full px-4" maxLength={300} placeholder={t("Message your party")} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn-accent" disabled={!text.trim()}>
          {t("Send")}
        </button>
      </form>
    </div>
  );
}
