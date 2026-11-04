import { XIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { supabase, errorMessage } from "../../lib/supabase";

type Row = Record<string, string | number | null>;
interface Signals {
  shared_ip_with_host: Row[];
  bidding_pairs: Row[];
  single_host_never_wins: Row[];
  bid_bursts: Row[];
  new_account_wins: Row[];
}

const SECTIONS: { key: keyof Signals; title: string; help: string; line: (r: Row) => string; link?: (r: Row) => string | null }[] = [
  {
    key: "shared_ip_with_host",
    title: "Bidder shares an IP address with the host",
    help: "Strong sign of a host bidding on their own lots with a second account.",
    line: (r) => `${r.bidder} bid in "${r.auction}" hosted by ${r.host} (IP ${r.ip})`,
    link: (r) => (r.auction_id ? `/a/${r.auction_id}` : null),
  },
  {
    key: "single_host_never_wins",
    title: "Bids almost only on one host and never wins",
    help: "Classic shill bidding: pushes prices up for one seller.",
    line: (r) => `${r.bidder}: ${r.bids} bids, ${r.share_pct}% on ${r.host}'s lots, 0 wins`,
  },
  {
    key: "bidding_pairs",
    title: "Pairs who keep bidding against each other",
    help: "Normal for rivals; suspicious when combined with the signals above.",
    line: (r) => `${r.a} vs ${r.b}: ${r.shared_lots} shared lots`,
  },
  {
    key: "bid_bursts",
    title: "Bid bursts (over 20 manual bids in one minute)",
    help: "Possible scripts or bots.",
    line: (r) => `${r.bidder}: ${r.bids} bids at ${new Date(String(r.minute)).toLocaleString()}`,
  },
  {
    key: "new_account_wins",
    title: "Accounts under 24 hours old winning lots",
    help: "Check before handing over valuable items.",
    line: (r) => `${r.winner} won "${r.lot}" for ${Number(r.price).toLocaleString()} (account ${r.account_age_hours}h old)`,
    link: (r) => (r.auction_id ? `/a/${r.auction_id}` : null),
  },
];

/** Admin: fraud signals and the chat blocked-word list. */
export function SafetyTab() {
  const [signals, setSignals] = useState<Signals | null>(null);
  const [words, setWords] = useState<string[]>([]);
  const [word, setWord] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadWords() {
    const { data } = await supabase.from("blocked_words").select("word").order("word");
    setWords((data ?? []).map((r) => r.word as string));
  }

  useEffect(() => {
    void supabase.rpc("admin_fraud_signals").then(({ data, error }) => {
      if (error) setError(errorMessage(error));
      else setSignals(data as Signals);
    });
    void loadWords();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    const w = word.trim().toLowerCase();
    if (!w) return;
    const { error } = await supabase.from("blocked_words").insert({ word: w });
    if (error) setError(errorMessage(error));
    else {
      setWord("");
      await loadWords();
    }
  }

  async function remove(w: string) {
    await supabase.from("blocked_words").delete().eq("word", w);
    await loadWords();
  }

  return (
    <div className="animate-rise space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="card space-y-3 p-5">
        <div>
          <h2 className="font-semibold">Chat filter</h2>
          <p className="text-sm text-stone-500">
            Blocked words are replaced with *** in every auction chat. Links are always blocked for non-staff unless a host allows them.
          </p>
        </div>
        <form onSubmit={add} className="flex max-w-md gap-2">
          <input className="input" placeholder="word to block" maxLength={40} value={word} onChange={(e) => setWord(e.target.value)} />
          <button className="btn-primary">Block</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {words.length === 0 && <span className="text-sm text-stone-500">No blocked words.</span>}
          {words.map((w) => (
            <span key={w} className="chip bg-stone-100 text-stone-700">
              {w}
              <button className="-my-1 -mr-2 ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-stone-200 hover:text-red-600" onClick={() => void remove(w)} aria-label={`Unblock ${w}`}>
                <XIcon size={14} weight="bold" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      </section>

      {!signals ? (
        <div className="h-40 animate-pulse rounded-2xl bg-stone-100" />
      ) : (
        SECTIONS.map((s) => {
          const rows = signals[s.key] ?? [];
          return (
            <section key={s.key} className="card overflow-hidden">
              <div className="border-b border-stone-100 px-4 py-3">
                <p className="font-semibold">
                  {s.title} <span className={`chip ml-1 ${rows.length ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-800"}`}>{rows.length}</span>
                </p>
                <p className="text-xs text-stone-500">{s.help}</p>
              </div>
              <ul className="divide-y divide-stone-100 text-sm">
                {rows.length === 0 && <li className="px-4 py-3 text-stone-500">Nothing found.</li>}
                {rows.map((r, i) => {
                  const href = s.link?.(r);
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                      <span>{s.line(r)}</span>
                      {href && (
                        <Link to={href} className="shrink-0 text-xs text-sky-700 hover:underline">
                          open
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
