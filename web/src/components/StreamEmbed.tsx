import { t } from "../lib/i18n";

const YOUTUBE_ID = /^[\w-]{6,20}$/;
const TWITCH_CHANNEL = /^\w{2,40}$/;

/** Turn a YouTube or Twitch link into an embeddable player URL. Twitch needs the embedding site's host (`parent`). */
export function embedUrl(raw: string, parent = typeof window === "undefined" ? "" : window.location.hostname): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  // YouTube's privacy-enhanced player: no tracking cookies until the viewer presses play.
  const youtube = (id: string | null | undefined) =>
    id && YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1` : null;

  if (host === "youtube.com") {
    return youtube(url.searchParams.get("v") ?? url.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]+)/)?.[1]);
  }
  if (host === "youtu.be") return youtube(url.pathname.slice(1));
  if (host === "twitch.tv") {
    const channel = url.pathname.split("/").filter(Boolean)[0];
    if (!channel || !TWITCH_CHANNEL.test(channel)) return null;
    const params = new URLSearchParams({ channel, parent, muted: "true" });
    return `https://player.twitch.tv/?${params}`;
  }
  return null;
}

export function StreamEmbed({ url }: { url: string }) {
  const src = embedUrl(url);
  if (!src) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="btn-ghost w-full">
        {t("Watch the live stream")}
      </a>
    );
  }
  return (
    <div className="aspect-video overflow-hidden rounded-2xl bg-black">
      <iframe
        src={src}
        title={t("Live stream")}
        className="h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
