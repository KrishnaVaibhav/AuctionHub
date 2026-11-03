const palette = ["bg-amber-200 text-amber-900", "bg-sky-200 text-sky-900", "bg-emerald-200 text-emerald-900", "bg-rose-200 text-rose-900", "bg-violet-200 text-violet-900", "bg-stone-300 text-stone-800"];

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
