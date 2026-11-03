import { useState } from "react";
import { publicUrl } from "../lib/media";
import type { LotMedia } from "../lib/types";

export function LotGallery({ items, title }: { items: LotMedia[]; title: string }) {
  const [index, setIndex] = useState(0);
  if (items.length === 0) {
    return <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-stone-100 text-sm text-stone-400">No photos</div>;
  }
  const current = items[Math.min(index, items.length - 1)];
  const src = publicUrl("lot-media", current.path);

  return (
    <div className="space-y-2">
      <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-stone-100">
        {current.kind === "video" ? (
          <video src={src} controls className="h-full w-full object-contain" />
        ) : (
          <img src={src} alt={title} className="h-full w-full object-contain" />
        )}
      </div>
      {items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setIndex(i)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${i === index ? "border-stone-900" : "border-transparent"}`}
            >
              {m.kind === "video" ? (
                <div className="flex h-full items-center justify-center bg-stone-800 text-xs text-white">Video</div>
              ) : (
                <img src={publicUrl("lot-media", m.path)} alt="" className="h-full w-full object-cover" loading="lazy" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
