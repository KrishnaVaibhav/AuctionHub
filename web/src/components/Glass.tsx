import { Glass, SegmentedControl, Switch, type SegmentedControlItem } from "glisse";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/**
 * Liquid Glass surface: glisse's lens (it bends what's behind its rim in
 * Chromium, with a lit rim everywhere) in AuctionHub's warm tint. Use it for
 * the floating layer: the nav, tab bar, bid bar and floating panels. The
 * `liquid` class (index.css) carries the tint, blur and shadow.
 */
export function LiquidGlass({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Glass className={`liquid ${className}`} {...props} />;
}

/** On/off switch with glisse's lens thumb, in brand amber. */
export function Toggle({
  checked,
  onChange,
  className = "",
  ...props
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  id?: string;
}) {
  return <Switch checked={checked} onCheckedChange={onChange} className={`shrink-0 ${className}`} {...props} />;
}

/**
 * Segmented control (a pick between a few options) with glisse's sliding,
 * lifting thumb. `width` is each segment's width in px.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  width = 84,
  className = "",
  "aria-label": label,
}: {
  items: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  width?: number;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <SegmentedControl
      items={items as SegmentedControlItem[]}
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      className={`segmented-lg ${className}`}
      style={{ "--lg-tab-width": `${width}px` } as CSSProperties}
    />
  );
}
