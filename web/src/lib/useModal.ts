import { useEffect, useRef } from "react";

// Open panels, innermost last: Escape closes only the top one.
const stack: { close: () => void }[] = [];

function onKeyDown(e: KeyboardEvent) {
  // A native <dialog> (confirmDialog) handles its own Escape.
  if (e.key !== "Escape" || !stack.length || document.querySelector("dialog[open]")) return;
  e.preventDefault();
  stack[stack.length - 1].close();
}

/**
 * For a panel shown over the page through a portal (sheets, drawers):
 * Escape closes it, focus moves into it and returns to where it was when it
 * closes, and the page behind (#root) is inert, so Tab and screen readers
 * stay inside the panel. Put the returned ref on the panel and give it
 * role="dialog", aria-modal="true", a label and tabIndex={-1}.
 */
export function useModal<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const entry = { close: () => close.current() };
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    stack.push(entry);
    if (stack.length === 1) {
      root?.setAttribute("inert", "");
      document.addEventListener("keydown", onKeyDown);
    }
    ref.current?.focus({ preventScroll: true });
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      if (!stack.length) {
        root?.removeAttribute("inert");
        document.removeEventListener("keydown", onKeyDown);
      }
      before?.focus({ preventScroll: true });
    };
  }, []);

  return ref;
}
