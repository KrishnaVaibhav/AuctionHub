/** Turn a YouTube or Twitch link into an embeddable player URL. */
export function embedUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");

  if (host === "youtube.com") {
    const id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{6,})/)?.[1];
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1` : null;
  }
  if (host === "youtu.be") {
    const id = url.pathname.slice(1);
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1` : null;
  }
  if (host === "twitch.tv") {
    const channel = url.pathname.split("/").filter(Boolean)[0];
    return channel ? `https://player.twitch.tv/?channel=${channel}&parent=${window.location.hostname}&muted=true` : null;
  }
  return null;
}

export function StreamEmbed({ url }: { url: string }) {
  const src = embedUrl(url);
  if (!src) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="btn-ghost w-full">
        Watch the live stream
      </a>
    );
  }
  return (
    <div className="aspect-video overflow-hidden rounded-2xl bg-black">
      <iframe
        src={src}
        title="Live stream"
        className="h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  );
}
