// 300 backgrounds + 950 text are not remapped by the dark theme, so avatars read the same in both modes.
const palette = ["bg-amber-300 text-amber-950", "bg-sky-300 text-sky-950", "bg-emerald-300 text-emerald-950", "bg-rose-300 text-rose-950", "bg-violet-300 text-violet-950", "bg-stone-300 text-stone-800"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({ name, url, size = 28 }: { name?: string | null; url?: string | null; size?: number }) {
  const label = (name ?? "?").trim();
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (url) return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  return (
    <span style={style} className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${palette[hash(label) % palette.length]}`}>
      {initials || "?"}
    </span>
  );
}
