import { useState } from "react";
import { CodeIcon } from "@phosphor-icons/react";
import type { Auction } from "../../lib/types";
import { Segmented } from "../../components/Glass";

/** Copy-paste iframe for showing a live auction on any website. */
export function EmbedPanel({ auction }: { auction: Auction }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [copied, setCopied] = useState(false);
  if (auction.visibility === "private") return null;
  const src = `${window.location.origin}/embed/${auction.id}${theme === "dark" ? "?theme=dark" : ""}`;
  const snippet = `<iframe src="${src}" title="${auction.title.replace(/"/g, "&quot;")} on AuctionHub" width="100%" height="460" style="border:0;border-radius:20px" loading="lazy"></iframe>`;

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
          <CodeIcon size={20} weight="bold" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-display text-lg font-extrabold">Embed on your website</h2>
          <p className="text-sm text-stone-500">A live widget with the lots, prices and countdowns. Visitors click through to bid.</p>
        </div>
      </div>
      <Segmented
        aria-label="Widget theme"
        value={theme}
        onChange={setTheme}
        items={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />
      <textarea className="input min-h-24 font-mono text-xs" readOnly value={snippet} aria-label="Embed code" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-accent" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy code"}
        </button>
        <a className="btn-ghost" href={src} target="_blank" rel="noreferrer">
          Preview
        </a>
      </div>
    </section>
  );
}
