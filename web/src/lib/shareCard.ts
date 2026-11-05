/**
 * Square share images drawn on a canvas (no server, no library): a win, a
 * badge, a season champion. Shared with the Web Share API when the device
 * supports files, otherwise downloaded.
 */
export interface CardSpec {
  eyebrow: string; // "I WON" / "NEW BADGE" / "CHAMPIONS"
  headline: string; // lot title, badge name, team name
  big: string; // price or points
  footer: string; // auction title or season
  accent?: string; // hex
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

export async function drawCard(spec: CardSpec): Promise<Blob> {
  const size = 1080;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const accent = spec.accent ?? "#f59e0b";

  // Background: deep ink with warm aurora blobs.
  ctx.fillStyle = "#0c0a09";
  ctx.fillRect(0, 0, size, size);
  const blob = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  };
  blob(860, 180, 520, accent + "aa");
  blob(980, 900, 420, "#f43f5eaa");
  blob(120, 1000, 380, "#f9731688");

  // Glass panel.
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(70, 70, size - 140, size - 140, 56);
  ctx.fill();
  ctx.stroke();

  const font = (w: number, px: number) => `${w} ${px}px "Inter Tight", -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = accent;
  ctx.font = font(800, 40);
  ctx.fillText(spec.eyebrow.toUpperCase(), 140, 200);

  ctx.fillStyle = "#ffffff";
  ctx.font = font(800, 76);
  const lines = wrap(ctx, spec.headline, size - 280, 3);
  lines.forEach((l, i) => ctx.fillText(l, 140, 310 + i * 88));

  ctx.font = font(800, 150);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(spec.big, 140, 360 + lines.length * 88 + 120);

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = font(600, 36);
  ctx.fillText(spec.footer.slice(0, 46), 140, 880);

  ctx.fillStyle = "#ffffff";
  ctx.font = font(800, 40);
  ctx.fillText("Auction", 140, 960);
  const w = ctx.measureText("Auction").width;
  ctx.fillStyle = accent;
  ctx.fillText("Hub", 140 + w, 960);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw the image"))), "image/png"));
}

export async function shareCard(spec: CardSpec, fileName = "auctionhub.png"): Promise<"shared" | "downloaded"> {
  await document.fonts?.ready;
  const blob = await drawCard(spec);
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: spec.headline, text: `${spec.eyebrow}: ${spec.headline} · ${spec.big}` });
      return "shared";
    } catch {
      // Cancelled: fall through to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
