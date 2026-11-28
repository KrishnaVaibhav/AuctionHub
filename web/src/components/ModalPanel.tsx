import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../lib/useModal";

/**
 * A panel over the page (sheets, drawers) on a dimmed backdrop, rendered
 * into <body>: a labelled modal dialog that closes on Escape or a tap on
 * the backdrop, and keeps focus inside (see useModal). `scrimClassName`
 * places the panel (centred, bottom sheet, right drawer).
 */
export function ModalPanel({
  onClose,
  label,
  className = "",
  scrimClassName = "",
  children,
}: {
  onClose: () => void;
  label: string;
  className?: string;
  scrimClassName?: string;
  children: ReactNode;
}) {
  const ref = useModal<HTMLDivElement>(onClose);
  return createPortal(
    // Pointer users close it by tapping the backdrop; keyboard users press Escape (useModal).
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className={`scrim ${scrimClassName}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`outline-none ${className}`}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
