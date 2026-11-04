import { useEffect, useState, type FormEvent } from "react";
import { WebhooksLogoIcon } from "@phosphor-icons/react";
import { supabase, errorMessage } from "../../lib/supabase";
import { confirmDialog } from "../../lib/confirm";

interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  last_sent_at: string | null;
}

const EVENTS = [
  ["auction.live", "Auction goes live"],
  ["auction.ended", "Auction ends"],
  ["lot.sold", "Lot sold"],
  ["lot.unsold", "Lot unsold"],
] as const;

/** Host webhooks: signed JSON POSTs for auction and lot events. */
export function WebhooksPanel() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(EVENTS.map(([e]) => e));
  const [shown, setShown] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const { data } = await supabase.from("host_webhooks").select("id, url, secret, events, active, last_sent_at").order("created_at");
    setHooks((data as Webhook[] | null) ?? []);
  }
  useEffect(() => void load(), []);

  async function add(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("host_webhooks").insert({ url: url.trim(), events });
    if (error) return setMsg({ ok: false, text: errorMessage(error) });
    setUrl("");
    setMsg({ ok: true, text: "Webhook added. Use its secret to verify the X-AuctionHub-Signature header." });
    await load();
  }

  async function remove(h: Webhook) {
    if (!(await confirmDialog({ title: "Delete this webhook?", body: h.url, confirmLabel: "Delete webhook", danger: true }))) return;
    await supabase.from("host_webhooks").delete().eq("id", h.id);
    await load();
  }

  async function test(h: Webhook) {
    const { error } = await supabase.rpc("test_webhook", { p_id: h.id });
    setMsg(error ? { ok: false, text: errorMessage(error) } : { ok: true, text: `Test event sent to ${h.url}` });
    await load();
  }

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
          <WebhooksLogoIcon size={20} weight="bold" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-display text-lg font-extrabold">Webhooks</h2>
          <p className="text-sm text-stone-500">
            Get a signed POST to your server when your auctions go live or end, and when lots sell. Works with Zapier, Make, n8n, Google Apps Script or your
            own API. Up to 5.
          </p>
        </div>
      </div>

      <form onSubmit={add} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="hook-url">
            Webhook URL
          </label>
          <input id="hook-url" className="input" type="url" required placeholder="https://example.com/auctionhub" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn-accent shrink-0">Add webhook</button>
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <legend className="sr-only">Events</legend>
          {EVENTS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={events.includes(key)}
                onChange={(e) => setEvents(e.target.checked ? [...events, key] : events.filter((x) => x !== key))}
              />
              {label}
            </label>
          ))}
        </fieldset>
      </form>
      <div role="status" aria-live="polite">
        {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>

      {hooks.length > 0 && (
        <ul className="divide-y divide-stone-100 text-sm">
          {hooks.map((h) => (
            <li key={h.id} className="space-y-1.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{h.url}</span>
                <button
                  className="btn-ghost px-3 py-1"
                  onClick={() => void supabase.from("host_webhooks").update({ active: !h.active }).eq("id", h.id).then(load)}
                  aria-pressed={h.active}
                >
                  {h.active ? "On" : "Off"}
                </button>
                <button className="btn-ghost px-3 py-1" onClick={() => void test(h)}>
                  Send test
                </button>
                <button className="btn-ghost px-3 py-1 text-red-600" onClick={() => void remove(h)}>
                  Delete
                </button>
              </div>
              <p className="text-xs text-stone-500">
                {h.events.join(", ")}
                {h.last_sent_at && ` · last sent ${new Date(h.last_sent_at).toLocaleString()}`}
              </p>
              <p className="text-xs text-stone-500">
                Secret:{" "}
                {shown === h.id ? (
                  <code className="rounded bg-stone-100 px-1 py-0.5 font-mono break-all select-all">{h.secret}</code>
                ) : (
                  <button className="underline" onClick={() => setShown(h.id)}>
                    show
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      <details className="text-xs text-stone-500">
        <summary className="cursor-pointer font-medium text-stone-700">How to verify a delivery</summary>
        <p className="mt-2">
          Each request has the headers <code>X-AuctionHub-Event</code> and <code>X-AuctionHub-Signature</code>. The signature is the hex HMAC-SHA256 of the raw
          request body, keyed with the webhook secret. Compute it on your side and compare.
        </p>
      </details>
    </section>
  );
}
