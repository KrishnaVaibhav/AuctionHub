/**
 * Security headers for every page of the app. Static files get them from
 * public/_headers (Cloudflare applies that file only to assets it serves
 * itself); pages the Worker builds, like /a/:id, get them from here.
 * security.test.ts keeps the two copies equal.
 */

// The inline theme script in index.html (sets light/dark before first paint).
// Editing that script changes its hash: security.test.ts names the new one.
const THEME_SCRIPT = "'sha256-LVvIf311o7/AgbuTOJd59FHpMyw38NRoENs/DL9F4h4='";

// Local Supabase, for `npm run preview` against `supabase start`.
const LOCAL_API = "http://127.0.0.1:54321";

export const CSP = [
  "default-src 'self'",
  `script-src 'self' ${THEME_SCRIPT}`,
  // React and the glass engine set styles at runtime.
  "style-src 'self' 'unsafe-inline'",
  // Photos come from Supabase Storage; covers and avatars may be any https image.
  `img-src 'self' data: blob: https: ${LOCAL_API}`,
  `media-src 'self' blob: https: ${LOCAL_API}`,
  "font-src 'self' data:",
  // Supabase (REST and realtime), Sentry, and league stats links the host pastes.
  `connect-src 'self' https: wss: ${LOCAL_API} ws://127.0.0.1:54321`,
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.twitch.tv",
  // The image compressor runs in a worker made from a blob: URL.
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Nobody may frame the app (clickjacking a Bid button). /embed/:id has its own policy.
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // Keeps the origin for YouTube (its player needs it), never the full URL with invite codes.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
};

/** A copy of `res` with the security headers set (HTML only: data and files don't need them). */
export function secure(res: Response): Response {
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
