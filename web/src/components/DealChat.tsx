import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { supabase, errorMessage, channelName } from "../lib/supabase";

interface DealMessage {
  id: number;
  lot_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}

/**
 * Private chat between a sold lot's host and its winner. Lets them arrange
 * payment and delivery without sharing personal contact details.
 */
export function DealChat({
  lotId,
  lotTitle,
  userId,
  otherName,
  onClose,
}: {
  lotId: string;
  lotTitle: string;
  userId: string;
  otherName: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<DealMessage[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.from("deal_messages").select("*").eq("lot_id", lotId).order("id").limit(500);
      if (error) setError(errorMessage(error));
      setMessages((data as DealMessage[] | null) ?? []);
    };
    const channel = supabase
      .channel(channelName(`deal:${lotId}`))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "deal_messages", filter: `lot_id=eq.${lotId}` }, (p) =>
        setMessages((prev) => (prev.some((m) => m.id === (p.new as DealMessage).id) ? prev : [...prev, p.new as DealMessage])),
      )
      .subscribe((s) => s === "SUBSCRIBED" && void load());
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [lotId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError(null);
    const { error } = await supabase.from("deal_messages").insert({ lot_id: lotId, sender_id: userId, body });
    if (error) setError(errorMessage(error));
    else setText("");
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex h-[85dvh] w-full max-w-lg animate-rise flex-col rounded-t-3xl bg-white shadow-2xl sm:h-[36rem] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-4">
          <div className="min-w-0">
            <p className="text-xs text-stone-500">Private deal chat · only you and {otherName}</p>
            <p className="truncate font-semibold">{lotTitle}</p>
          </div>
          <button className="btn-ghost px-2.5 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">
              Agree on payment and delivery here. Your email and phone stay private unless you choose to share them.
            </p>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === userId;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <p
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-line ${mine ? "rounded-br-sm bg-stone-900 text-white" : "rounded-bl-sm bg-stone-100"}`}
                >
                  {m.body}
                  <span className={`mt-0.5 block text-[10px] ${mine ? "text-stone-400" : "text-stone-500"}`}>
                    {new Date(m.created_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                  </span>
                </p>
              </div>
            );
          })}
        </div>
        <form onSubmit={send} className="border-t border-stone-100 p-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <input className="input" placeholder="Write a message..." maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn-primary" disabled={!text.trim()}>
              Send
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
