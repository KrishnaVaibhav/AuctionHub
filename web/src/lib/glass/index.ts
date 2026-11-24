import { attachGlass } from "./refraction";

/**
 * Every surface that is glass. Each one becomes a real lens: glisse's engine
 * (refraction.ts) bends the page behind its rim through a rounded bezel, in
 * Chromium with an SVG backdrop filter, and paints the lit rim iOS draws on
 * glass for its exact size and corners, in every browser. Blur is only a
 * light frost on top (see the glass utilities in index.css).
 */
export const GLASS_SELECTOR = ".glass, .glass-thick, .glass-clear, .segmented, .sheet, .toolbar, .btn-glass";

/**
 * Watches the page and turns every element matching `selector` into a lens as
 * it appears, and lets it go when it leaves or loses its glass class. Call
 * once at startup. Returns a function that stops it all.
 */
export function installGlass(selector = GLASS_SELECTOR): () => void {
  if (typeof document === "undefined") return () => {};
  const attached = new Map<HTMLElement, () => void>();

  const add = (el: Element) => {
    if (el instanceof HTMLElement && !attached.has(el)) attached.set(el, attachGlass(el));
  };
  const scan = (root: Element) => {
    if (root.matches(selector)) add(root);
    root.querySelectorAll(selector).forEach(add);
  };
  const prune = () => {
    for (const [el, stop] of attached) {
      if (el.isConnected && el.matches(selector)) continue;
      stop();
      attached.delete(el);
    }
  };

  const observer = new MutationObserver((records) => {
    let gone = false;
    for (const record of records) {
      if (record.type === "attributes") {
        const el = record.target as Element;
        if (el.matches(selector)) add(el);
        else if (attached.has(el as HTMLElement)) gone = true;
        continue;
      }
      record.addedNodes.forEach((node) => node instanceof Element && scan(node));
      if (record.removedNodes.length) gone = true;
    }
    if (gone) prune();
  });

  scan(document.body);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  return () => {
    observer.disconnect();
    for (const stop of attached.values()) stop();
    attached.clear();
  };
}
