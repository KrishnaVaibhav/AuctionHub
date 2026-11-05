/**
 * Matches dropped photo files to lots by file name:
 *   1. a leading number is the lot number shown to bidders ("12.jpg", "12-2.jpg", "lot 12 b.png")
 *   2. otherwise the name is compared with lot titles ("brass-lamp_back.jpg" -> "Brass lamp")
 * Files that match nothing are grouped by base name so each group can become a new lot.
 */

export interface LotRef {
  id: string;
  position: number; // 0-based; shown as #position+1
  title: string;
}

export type Target = { kind: "lot"; lotId: string } | { kind: "new"; group: string } | { kind: "skip" };

export interface PhotoPlan {
  file: File;
  target: Target;
  reason: "number" | "title" | "none";
}

const stem = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, "");

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** File name without extension or trailing copy markers: "Brass lamp (2).JPG" -> "brass lamp". */
export function baseName(fileName: string): string {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  return slug(stem)
    .replace(/\s+(\d{1,2}|[a-d]|copy|front|back|side|top|detail)$/i, "")
    .replace(/\s+(\d{1,2}|[a-d])$/i, "")
    .trim();
}

/** Lot number from a name like "12", "12-3", "lot_12", "#12 front". */
export function lotNumber(fileName: string): number | null {
  const m = slug(fileName.replace(/\.[a-z0-9]{2,5}$/i, "")).match(/^(?:lot\s*)?(\d{1,4})(?:\s|$)/);
  return m ? Number(m[1]) : null;
}

/** Title for a new lot made from a group of files. */
export function titleFromGroup(group: string): string {
  const t = group.replace(/\s+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Untitled lot";
}

export function planPhotos(files: File[], lots: LotRef[]): PhotoPlan[] {
  const byNumber = new Map(lots.map((l) => [l.position + 1, l.id]));
  const titled = lots.map((l) => ({ id: l.id, s: slug(l.title) })).filter((l) => l.s.length >= 3);

  return files
    .filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"))
    .sort((a, b) => stem(a.name).localeCompare(stem(b.name), undefined, { numeric: true }))
    .map((file) => {
      const n = lotNumber(file.name);
      if (n != null && byNumber.has(n)) return { file, target: { kind: "lot", lotId: byNumber.get(n)! }, reason: "number" } as PhotoPlan;
      const base = baseName(file.name);
      // Longest matching title wins, so "brass lamp large" beats "lamp".
      const hit = titled
        .filter((l) => base === l.s || base.startsWith(l.s + " ") || l.s.startsWith(base + " ") || (base.length >= 4 && l.s === base))
        .sort((a, b) => b.s.length - a.s.length)[0];
      if (hit) return { file, target: { kind: "lot", lotId: hit.id }, reason: "title" } as PhotoPlan;
      return { file, target: base ? { kind: "new", group: base } : { kind: "skip" }, reason: "none" } as PhotoPlan;
    });
}

/** Runs async jobs with a small concurrency limit, reporting progress. */
export async function runLimited<T>(items: T[], limit: number, job: (item: T) => Promise<void>, onDone: (done: number) => void) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await job(item);
      onDone(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
