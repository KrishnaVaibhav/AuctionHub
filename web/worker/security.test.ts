import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import headersFile from "../public/_headers?raw";
import { CSP, SECURITY_HEADERS, secure } from "./security";

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}

// What Cloudflare builds from git: LF line endings (.gitattributes), whatever this checkout uses.
const lf = (text: string) => text.replace(/\r\n/g, "\n");

/** The header lines of the `/*` rule in public/_headers, as { name: value }. */
function staticRule(): Record<string, string> {
  const file = lf(headersFile);
  const start = file.indexOf("\n/*\n") + 4;
  const rule = file.slice(start).split("\n\n")[0];
  const entries = rule
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]);
  return Object.fromEntries(entries);
}

describe("security headers", () => {
  it("allow index.html's inline theme script by its exact hash", async () => {
    const scripts = [...lf(indexHtml).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    // If this fails, the theme script changed: put the new hash in worker/security.ts and public/_headers.
    expect(CSP).toContain(`'sha256-${await sha256(scripts[0])}'`);
  });

  it("are the same in public/_headers as in the Worker", () => {
    expect(staticRule()).toEqual(SECURITY_HEADERS);
  });

  it("keep _headers lines under Cloudflare's 2,000 character limit", () => {
    for (const line of headersFile.split("\n")) expect(line.length).toBeLessThan(2000);
  });

  it("forbid framing and plugins", () => {
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).toContain("object-src 'none'");
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });

  it("are added to HTML responses only", () => {
    const html = secure(new Response("<p>hi</p>", { headers: { "content-type": "text/html; charset=utf-8" } }));
    expect(html.headers.get("content-security-policy")).toBe(CSP);
    expect(html.headers.get("x-frame-options")).toBe("DENY");
    const json = secure(Response.json({ ok: true }));
    expect(json.headers.get("content-security-policy")).toBeNull();
  });
});
