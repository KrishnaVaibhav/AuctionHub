import { useState } from "react";
import { CameraIcon } from "@phosphor-icons/react";
import { publicUrl } from "../lib/media";
import type { LotMedia } from "../lib/types";

export function LotGallery({ items, title }: { items: LotMedia[]; title: string }) {
  const [index, setIndex] = useState(0);
  if (items.length === 0) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-[28px] bg-stone-900/[0.04] text-sm text-stone-500">
        <CameraIcon size={28} aria-hidden="true" />
        No photos
      </div>
    );
  }
  const current = items[Math.min(index, items.length - 1)];
  const src = publicUrl("lot-media", current.path);

  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[28px] bg-stone-100">
        {current.kind === "video" ? (
          <video src={src} controls className="h-full w-full object-contain" />
        ) : (
          <img src={src} alt={title} className="h-full w-full object-contain" />
        )}
        {items.length > 1 && (
          <span className="glass-clear chip absolute top-3 right-3 px-3 py-1 text-stone-900 tabular-nums" aria-hidden="true">
            {Math.min(index, items.length - 1) + 1} / {items.length}
          </span>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((m, i) => (
            <button
              key={m.id}
              onClick={() => setIndex(i)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition ${i === index ? "border-brand-500" : "border-transparent opacity-70 hover:opacity-100"}`}
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
