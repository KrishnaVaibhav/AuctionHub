import { useRef } from "react";
import { Link } from "react-router";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import {
  ArrowRightIcon,
  BroadcastIcon,
  ChatsCircleIcon,
  CompassIcon,
  FileCsvIcon,
  GavelIcon,
  HandCoinsIcon,
  LightningIcon,
  ReceiptIcon,
  TimerIcon,
  TrophyIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { t } from "../../lib/i18n";
import { CATEGORIES } from "../../lib/categories";
import { CategoryIcon } from "../CategoryIcon";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * The story under the auction browser, for visitors who are not signed in:
 * what AuctionHub does (bento), how it feels (scrubbed manifesto), what hosts
 * get (pinned split), how bidding works (accordion), then one clear CTA.
 * Real auction covers are the imagery; gradients stand in when there are none.
 * All motion turns off under prefers-reduced-motion.
 */
export default function Landing({ covers }: { covers: string[] }) {
  const root = useRef<HTMLDivElement>(null);
  const img = (i: number) => covers.length ? covers[i % covers.length] : null;

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // Manifesto: each word scrubs from faint to full as it scrolls through.
        gsap.fromTo(
          ".manifesto-word",
          { opacity: 0.12 },
          { opacity: 1, stagger: 0.08, ease: "none", scrollTrigger: { trigger: ".manifesto", start: "top 75%", end: "bottom 45%", scrub: true } },
        );
        // Images grow in as they arrive and dim as they leave.
        gsap.utils.toArray<HTMLElement>(".scale-in").forEach((el) => {
          gsap.fromTo(el, { scale: 0.86 }, { scale: 1, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "center center", scrub: true } });
          gsap.to(el, { opacity: 0.25, ease: "none", scrollTrigger: { trigger: el, start: "center 25%", end: "bottom top", scrub: true } });
        });
      });
      // Pinned split: the host title stays while the tool cards scroll past (wide screens only).
      mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
        ScrollTrigger.create({ trigger: ".host-split", start: "top 96px", end: "bottom bottom", pin: ".host-pin", pinSpacing: false });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [covers.length] },
  );

  const manifesto = t("An auction should feel like a room, not a form. You watch the price move, hear the room talk, and know the moment you win.");

  return (
    <div ref={root} className="w-full max-w-full overflow-x-clip">
      {/* Categories, drifting past */}
      <section aria-label={t("Categories")} className="relative -mx-4 overflow-hidden py-16 sm:-mx-6 md:py-24">
        <div className="marquee flex w-max font-display text-3xl font-extrabold tracking-tight text-stone-900/80 sm:text-5xl">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center gap-10 pr-10" aria-hidden={copy === 1}>
              {CATEGORIES.map(([key, label]) => (
                <span key={key} className="flex items-center gap-4 whitespace-nowrap">
                  <CategoryIcon name={key} className="h-8 w-8 text-brand-600 sm:h-11 sm:w-11" />
                  {t(label)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* Interest: what it does. 4 cols x 2 rows = 8 cells: 4 + 2 + 1 + 1. */}
      <section className="py-24 md:py-40">
        <h2 className="max-w-5xl font-display text-[clamp(2rem,4vw,3.75rem)] leading-[1.05] font-extrabold tracking-tight text-balance">
          {t("Built for the moment the hammer falls.")}
        </h2>
        <div className="mt-12 grid grid-flow-dense auto-rows-[minmax(15rem,auto)] gap-4 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-2">
          <article className="group relative isolate overflow-hidden rounded-[32px] bg-ink p-8 text-snow md:col-span-2 md:row-span-2">
            <Shot src={img(0)} className="opacity-55 grayscale-[35%] contrast-125" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/60 to-transparent" />
            <div className="flex h-full min-h-[22rem] flex-col justify-end">
              <GavelIcon size={36} weight="duotone" className="text-brand-400" aria-hidden="true" />
              <h3 className="mt-4 max-w-md font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{t("Every bid lands for everyone at once.")}</h3>
              <p className="mt-3 max-w-md text-snow/75">{t("Bids, chat and the hammer reach the whole room in the same second. No refresh button.")}</p>
            </div>
          </article>
          <article className="group relative isolate overflow-hidden rounded-[32px] bg-gradient-to-br from-violet-600 to-indigo-900 p-8 text-snow md:col-span-2">
            <Shot src={img(1)} className="opacity-25 mix-blend-luminosity" />
            <TrophyIcon size={32} weight="duotone" aria-hidden="true" />
            <h3 className="mt-4 font-display text-2xl font-extrabold tracking-tight">{t("Team leagues")}</h3>
            <p className="mt-2 max-w-md text-snow/80">{t("Purses, squads, retentions and trades, run like a real player auction.")}</p>
          </article>
          <article className="group card flex flex-col justify-between p-8">
            <LightningIcon size={32} weight="duotone" className="text-brand-600 transition duration-700 group-hover:scale-110" aria-hidden="true" />
            <div>
              <h3 className="font-display text-2xl font-extrabold tracking-tight">{t("Auto-bid")}</h3>
              <p className="mt-2 text-sm text-stone-600">{t("Set a ceiling. It bids the minimum for you, only when someone outbids you.")}</p>
            </div>
          </article>
          <article className="group card flex flex-col justify-between p-8">
            <span className="flex items-baseline gap-2">
              <TimerIcon size={32} weight="duotone" className="text-rose-500" aria-hidden="true" />
              <span className="font-display text-4xl font-extrabold tabular-nums text-stone-900 transition duration-700 group-hover:scale-105">+30s</span>
            </span>
            <div>
              <h3 className="font-display text-2xl font-extrabold tracking-tight">{t("Anti-snipe")}</h3>
              <p className="mt-2 text-sm text-stone-600">{t("A late bid adds time, so nobody wins by a second.")}</p>
            </div>
          </article>
        </div>
      </section>

      {/* Desire: the feeling, scrubbed word by word */}
      <section className="manifesto py-24 md:py-40">
        <p className="mx-auto max-w-5xl text-center font-display text-[clamp(1.75rem,3.6vw,3.25rem)] leading-[1.15] font-extrabold tracking-tight text-balance">
          {manifesto.split(" ").map((word, i) => (
            <span key={i} className="manifesto-word">
              {word}{" "}
            </span>
          ))}
        </p>
      </section>

      {/* Desire: host tools. Title pinned on the left while the cards scroll on the right. */}
      <section className="host-split grid gap-10 py-24 md:py-40 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="host-pin self-start">
          <h2 className="font-display text-[clamp(2rem,4vw,3.75rem)] leading-[1.05] font-extrabold tracking-tight text-balance">{t("Run the room like a broadcast.")}</h2>
          <p className="mt-4 max-w-md text-lg text-stone-600">{t("Everything a host needs, in one place.")}</p>
          <Link to="/host" className="btn-primary mt-8 px-6 py-3 text-base">
            {t("Host an auction")}
            <ArrowRightIcon size={18} weight="bold" aria-hidden="true" />
          </Link>
        </div>
        <div className="space-y-5">
          {(
            [
              [UsersThreeIcon, "Co-hosts", "Share the work: one person edits lots, another runs the clock."],
              [BroadcastIcon, "Live stream", "Paste a YouTube or Twitch link and it plays beside the bidding."],
              [FileCsvIcon, "Import from a sheet", "Bring in hundreds of lots from a CSV file, then drop in the photos by file name."],
              [ReceiptIcon, "Results and replay", "See who won what, download the results, and replay the whole night."],
            ] as const
          ).map(([Glyph, title, text], i) => (
            <article key={title} className="group card scale-in overflow-hidden">
              <div className="relative isolate h-48 overflow-hidden sm:h-56">
                <Shot src={img(i + 2)} className="contrast-110 saturate-[0.85]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              </div>
              <div className="flex items-start gap-4 p-6">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
                  <Glyph size={24} weight="bold" aria-hidden="true" />
                </span>
                <span>
                  <h3 className="font-display text-xl font-extrabold tracking-tight">{t(title)}</h3>
                  <p className="mt-1 text-stone-600">{t(text)}</p>
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* How bidding works: slices that widen on hover (stacked on phones) */}
      <section className="py-24 md:py-40">
        <h2 className="font-display text-[clamp(2rem,4vw,3.75rem)] leading-[1.05] font-extrabold tracking-tight">{t("How it works")}</h2>
        <ol className="mt-12 flex flex-col gap-3 lg:h-[26rem] lg:flex-row">
          {(
            [
              [CompassIcon, "Find a room", "Browse live and upcoming auctions, or open an invite link."],
              [HandCoinsIcon, "Bid or set a ceiling", "Tap the next bid, type your own, or let auto-bid handle it."],
              [GavelIcon, "Win the lot.", "When the clock ends, the highest bid wins and the whole room sees it."],
              [ChatsCircleIcon, "Settle up", "Chat with the host privately to arrange payment and pickup."],
            ] as const
          ).map(([Glyph, title, text], i) => (
            <li
              key={title}
              className="group relative isolate flex min-h-40 flex-col justify-end overflow-hidden rounded-[28px] bg-ink p-6 text-snow transition-[flex-grow] duration-700 ease-[var(--ease-spring)] lg:flex-1 lg:hover:flex-[2.6]"
            >
              <Shot src={img(i + 6)} className="opacity-40 grayscale contrast-125 group-hover:opacity-60" />
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink via-ink/70 to-ink/20" />
              <span className="font-display text-sm font-bold text-brand-400 tabular-nums">0{i + 1}</span>
              <Glyph size={30} weight="duotone" className="mt-3 text-snow" aria-hidden="true" />
              <h3 className="mt-3 font-display text-2xl font-extrabold tracking-tight">{t(title)}</h3>
              <p className="mt-2 max-w-sm text-snow/75 lg:opacity-70 lg:transition lg:duration-500 lg:group-hover:opacity-100">{t(text)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Action */}
      <section className="py-24 md:py-40">
        <div className="relative isolate overflow-hidden rounded-[40px] bg-ink px-6 py-20 text-center text-snow sm:px-12 md:py-28">
          <div className="aurora absolute inset-0 -z-10 opacity-70" aria-hidden="true" />
          <h2 className="mx-auto max-w-5xl font-display text-[clamp(2.2rem,5vw,4.75rem)] leading-[1.02] font-extrabold tracking-tight text-balance">
            {t("Your first auction is ten minutes away.")}
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to="/host" className="btn-accent px-7 py-3.5 text-base">
              {t("Host an auction")}
              <ArrowRightIcon size={18} weight="bold" aria-hidden="true" />
            </Link>
            <Link to="/login?mode=signup" className="btn px-7 py-3.5 text-base bg-snow text-ink hover:bg-snow/90">
              {t("Create account")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

/** A cover photo filling its card, zooming slightly on hover; a warm gradient when there is no photo. */
function Shot({ src, className = "" }: { src: string | null; className?: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className={`absolute inset-0 -z-10 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 ${className}`} />
  ) : (
    <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_70%_20%,rgb(251_191_36/0.45),transparent),radial-gradient(50%_50%_at_10%_90%,rgb(244_63_94/0.35),transparent)] transition-transform duration-700 group-hover:scale-105" />
  );
}
