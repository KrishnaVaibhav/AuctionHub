import type { ReactNode } from "react";
import { useModal } from "../lib/useModal";

/**
 * The panel inside a scrim overlay (sheets, drawers): a labelled modal
 * dialog that closes on Escape and keeps focus inside (see useModal).
 * Clicks inside don't reach the scrim, whose click closes the overlay.
 */
export function ModalPanel({ onClose, label, className = "", children }: { onClose: () => void; label: string; className?: string; children: ReactNode }) {
  const ref = useModal<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`outline-none ${className}`} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}
