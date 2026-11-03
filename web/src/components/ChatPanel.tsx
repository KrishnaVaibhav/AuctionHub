import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase, errorMessage, channelName } from "../lib/supabase";
import { useProfileNames } from "../lib/profiles";
import type { Auction, ChatMessage } from "../lib/types";

interface Props {
  auction: Auction;
  userId: string | null;
  isStaff: boolean;
}

const PAGE = 100;

export function ChatPanel({ auction, userId, isStaff }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const names = useProfileNames(messages.map((m) => m.user_id));

  const chatOpen =
    ["scheduled", "live", "paused"].includes(auction.status) && auction.settings.chat?.enabled !== false;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("auction_id", auction.id)
        .order("id", { ascending: false })
        .limit(PAGE);
      if (!cancelled) setMessages(((data as ChatMessage[] | null) ?? []).reverse());
    };

    const channel = supabase
      .channel(channelName(`chat:${auction.id}`))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `auction_id=eq.${auction.id}` },
        (p) =>
          setMessages((prev) => {
            const row = p.new as ChatMessage;
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row].slice(-PAGE * 2);
          }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages", filter: `auction_id=eq.${auction.id}` },
        (p) => setMessages((prev) => prev.map((m) => (m.id === (p.new as ChatMessage).id ? (p.new as ChatMessage) : m))),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [auction.id]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !userId) return;
    setSending(true);
    setError(null);
    const { error } = await supabase.from("chat_messages").insert({ auction_id: auction.id, user_id: userId, body });
    setSending(false);
    if (error) setError(errorMessage(error));
    else {
      setText("");
      stickToBottom.current = true;
    }
  }

  async function moderate(m: ChatMessage, action: "pin" | "unpin" | "delete" | "mute") {
    setError(null);
    let res;
    if (action === "mute") {
      if (!m.user_id) return;
      res = await supabase.from("chat_mutes").upsert({
        auction_id: auction.id,
        user_id: m.user_id,
        until: new Date(Date.now() + 10 * 60_000).toISOString(),
        created_by: userId,
      });
    } else {
      const patch = action === "delete" ? { deleted_at: new Date().toISOString(), pinned: false } : { pinned: action === "pin" };
      res = await supabase.from("chat_messages").update(patch).eq("id", m.id);
    }
    if (res.error) setError(errorMessage(res.error));
  }

  const visible = messages.filter((m) => !m.deleted_at);
  const pinned = visible.filter((m) => m.pinned);

  return (
    <div className="card flex h-[70dvh] flex-col lg:h-[calc(100dvh-8rem)] lg:max-h-[44rem]">
      <div className="border-b border-stone-200 px-4 py-3">
        <h2 className="font-semibold">Live chat</h2>
      </div>

      {pinned.length > 0 && (
        <div className="space-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm">
          {pinned.map((m) => (
            <p key={m.id}>
              <span className="mr-1 font-semibold text-amber-800">Pinned:</span>
              {m.body}
            </p>
          ))}
        </div>
      )}

      <div
        ref={listRef}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3 text-sm"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {visible.length === 0 && <p className="text-stone-400">No messages yet. Say hello!</p>}
        {visible.map((m) =>
          m.kind === "text" ? (
            <div key={m.id} className="group flex items-start gap-2">
              <p className="min-w-0 flex-1 break-words">
                <span className={`mr-1.5 font-semibold ${m.user_id === auction.host_id ? "text-brand-700" : ""}`}>
                  {m.user_id ? (names.get(m.user_id) ?? "...") : "Unknown"}
                  {m.user_id === auction.host_id && <span className="ml-1 text-[10px] uppercase">host</span>}
                </span>
                {m.body}
              </p>
              {isStaff && (
                <span className="hidden shrink-0 gap-1 text-xs text-stone-400 group-hover:flex">
                  <button onClick={() => void moderate(m, m.pinned ? "unpin" : "pin")} className="hover:text-stone-900">
                    {m.pinned ? "unpin" : "pin"}
                  </button>
                  <button onClick={() => void moderate(m, "delete")} className="hover:text-red-600">
                    delete
                  </button>
                  {m.user_id && m.user_id !== auction.host_id && (
                    <button onClick={() => void moderate(m, "mute")} className="hover:text-red-600">
                      mute
                    </button>
                  )}
                </span>
              )}
            </div>
          ) : (
            <p
              key={m.id}
              className={`rounded-md px-2 py-1 text-xs ${m.kind === "bid" ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-600"}`}
            >
              {m.body}
            </p>
          ),
        )}
      </div>

      <form onSubmit={send} className="border-t border-stone-200 p-3">
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        {userId && chatOpen ? (
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Say something..."
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn-primary" disabled={sending || !text.trim()}>
              Send
            </button>
          </div>
        ) : (
          <p className="text-center text-xs text-stone-500">{userId ? "Chat is closed." : "Sign in to chat."}</p>
        )}
      </form>
    </div>
  );
}
