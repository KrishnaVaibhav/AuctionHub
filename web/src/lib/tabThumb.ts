/**
 * Sliding selection for every tab bar (`.segmented`): instead of the active
 * tab's background jumping, one capsule springs from the old tab to the new
 * one, as iOS segmented controls do. The bar keeps its own markup; this sets
 * --thumb-x/-y/-w/-h on it, which `.segmented[data-thumb]::before` draws
 * (index.css). Works for any bar, now and later, on every page.
 */
const ACTIVE = '.tab-active, [aria-selected="true"], [aria-checked="true"]';

export function installTabThumbs(selector = ".segmented"): () => void {
  if (typeof document === "undefined") return () => {};
  const bars = new Map<HTMLElement, ResizeObserver>();

  const place = (bar: HTMLElement) => {
    const active = [...bar.querySelectorAll<HTMLElement>(ACTIVE)].find((el) => el.closest(selector) === bar && el.offsetParent !== null);
    if (!active) {
      bar.removeAttribute("data-thumb");
      return;
    }
    bar.style.setProperty("--thumb-x", `${active.offsetLeft}px`);
    bar.style.setProperty("--thumb-y", `${active.offsetTop}px`);
    bar.style.setProperty("--thumb-w", `${active.offsetWidth}px`);
    bar.style.setProperty("--thumb-h", `${active.offsetHeight}px`);
    if (!bar.hasAttribute("data-thumb")) {
      // First placement: appear in place, then animate from the next change on.
      bar.setAttribute("data-thumb", "instant");
      requestAnimationFrame(() => requestAnimationFrame(() => bar.isConnected && bar.setAttribute("data-thumb", "")));
    }
  };

  const track = (el: Element) => {
    if (!(el instanceof HTMLElement) || bars.has(el)) return;
    const ro = new ResizeObserver(() => place(el));
    ro.observe(el);
    bars.set(el, ro);
    place(el);
  };
  const scan = (root: Element) => {
    if (root.matches(selector)) track(root);
    root.querySelectorAll(selector).forEach(track);
  };

  const observer = new MutationObserver((records) => {
    const touched = new Set<HTMLElement>();
    let removed = false;
    for (const record of records) {
      record.addedNodes.forEach((node) => node instanceof Element && scan(node));
      if (record.removedNodes.length) removed = true;
      const bar = (record.target instanceof Element ? record.target : record.target.parentElement)?.closest<HTMLElement>(selector);
      if (bar) touched.add(bar);
    }
    if (removed)
      for (const [bar, ro] of bars)
        if (!bar.isConnected) {
          ro.disconnect();
          bars.delete(bar);
        }
    touched.forEach((bar) => bars.has(bar) && place(bar));
  });

  scan(document.body);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "aria-selected", "aria-checked"],
  });
  // Web fonts change tab widths after first paint.
  void document.fonts?.ready.then(() => bars.forEach((_, bar) => place(bar)));
  return () => {
    observer.disconnect();
    bars.forEach((ro) => ro.disconnect());
    bars.clear();
  };
}
