/*
 * Spring press, as on iOS 26 glass buttons: a held button grows a little,
 * stretches towards the finger as it drags, and springs back past its resting
 * size on release.
 *
 * Adapted from glisse (https://github.com/0kzh/glisse), MIT License,
 * Copyright (c) Kelvin Zhang. The spring solver and the press feel are its;
 * this version is one delegated listener for the whole page, so every button
 * gets it without a hook per component.
 */

interface Spring {
  value: number;
  target: number;
  velocity: number;
  stiffness: number;
  damping: number;
  paint: () => void;
}

const moving = new Set<Spring>();
let frame = 0;
let last = 0;

// Closed-form step of a damped spring (exact for any dt, so frame drops don't wobble).
function advance(s: Spring, dt: number): void {
  const x = s.value - s.target;
  const v = s.velocity;
  const half = s.damping / 2;
  const discriminant = half * half - s.stiffness;
  if (Math.abs(discriminant) < 1e-4) {
    const decay = Math.exp(-half * dt);
    const b = v + half * x;
    s.value = s.target + decay * (x + b * dt);
    s.velocity = decay * (v - half * b * dt);
  } else if (discriminant > 0) {
    const root = Math.sqrt(discriminant);
    const r1 = -half + root;
    const r2 = -half - root;
    const a = (v - r2 * x) / (r1 - r2);
    const b = x - a;
    s.value = s.target + a * Math.exp(r1 * dt) + b * Math.exp(r2 * dt);
    s.velocity = a * r1 * Math.exp(r1 * dt) + b * r2 * Math.exp(r2 * dt);
  } else {
    const omega = Math.sqrt(-discriminant);
    const decay = Math.exp(-half * dt);
    const cos = Math.cos(omega * dt);
    const sin = Math.sin(omega * dt);
    s.value = s.target + decay * (x * cos + ((v + half * x) / omega) * sin);
    s.velocity = decay * (v * cos - ((half * v + s.stiffness * x) / omega) * sin);
  }
}

function tick(time: number): void {
  frame = 0;
  const dt = Math.min(0.1, Math.max(0, (time - last) / 1000));
  last = time;
  const painted = new Set<() => void>();
  for (const s of moving) {
    advance(s, dt);
    if (Math.abs(s.value - s.target) < 1e-4 && Math.abs(s.velocity) < 1e-3) {
      s.value = s.target;
      s.velocity = 0;
      moving.delete(s);
    }
    painted.add(s.paint);
  }
  painted.forEach((paint) => paint());
  if (moving.size) frame = requestAnimationFrame(tick);
}

function drive(s: Spring, target: number, stiffness: number, damping: number): void {
  s.target = target;
  s.stiffness = stiffness;
  s.damping = damping;
  if (document.hidden) {
    s.value = target;
    s.velocity = 0;
    moving.delete(s);
    s.paint();
    return;
  }
  moving.add(s);
  if (!frame) {
    last = Number(document.timeline?.currentTime ?? performance.now());
    frame = requestAnimationFrame(tick);
  }
}

interface Feel {
  /** How many pixels the longer side grows while pressed. */
  grow: number;
  press: readonly [number, number];
  release: readonly [number, number];
}

// A mouse press stays subtle; a finger gets the full iOS glass-button bounce.
const POINTER: Feel = { grow: 6, press: [417.6, 29.2], release: [230, 23.7] };
const TOUCH: Feel = { grow: 15, press: [515, 27.3], release: [250, 11.8] };

/** Makes one element pressable; returns its pointerdown handler. */
function pressable(el: HTMLElement): (event: PointerEvent) => void {
  const rest = [1, 1, 0, 0];
  const paint = () => {
    const [sx, sy, tx, ty] = springs.map((s) => s.value);
    if (springs.every((s, i) => s.value === rest[i] && !moving.has(s))) {
      // Back at rest: drop the properties, so the button isn't left a containing block.
      el.style.removeProperty("scale");
      el.style.removeProperty("translate");
      return;
    }
    el.style.scale = `${sx} ${sy}`;
    el.style.translate = `${tx}px ${ty}px`;
  };
  const springs: Spring[] = rest.map((value) => ({ value, target: value, velocity: 0, stiffness: 0, damping: 0, paint }));
  const to = (next: number[], [stiffness, damping]: readonly [number, number]) =>
    springs.forEach((s, i) => drive(s, next[i]!, stiffness, damping));

  let pointer: { id: number; x: number; y: number; box: DOMRect; feel: Feel } | null = null;

  const track = (event: PointerEvent) => {
    if (!pointer) return;
    const { box, feel } = pointer;
    const { width, height } = box;
    if (!width || !height) return;
    const base = 1 + feel.grow / Math.max(width, height);
    const aspect = width / height;
    const dx = (event.clientX - pointer.x) / aspect;
    const dy = event.clientY - pointer.y;
    const length = Math.hypot(dx, dy);
    if (!length) return to([base, base, 0, 0], feel.press);
    const nx = dx / length;
    const ny = dy / length;
    const rubber = 1 - 1 / (1 + length / height / (5 * aspect));
    const stretch = 1 + (6 / height) * rubber * Math.abs(Math.abs(nx) - Math.abs(ny));
    const horizontal = Math.abs(nx) > Math.abs(ny);
    to(
      [base * (horizontal ? stretch : 1 / stretch), base * (horizontal ? 1 / stretch : stretch), nx * 8 * rubber, ny * 8 * rubber],
      feel.press,
    );
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointer?.id) track(event);
  };
  const end = (event?: Event) => {
    if (event instanceof PointerEvent && event.pointerId !== pointer?.id) return;
    const feel = pointer?.feel ?? POINTER;
    pointer = null;
    delete el.dataset.pressed;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", end);
    to(rest, feel.release);
  };
  return (event: PointerEvent) => {
    if (pointer) return;
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      box: el.getBoundingClientRect(),
      feel: event.pointerType === "mouse" ? POINTER : TOUCH,
    };
    el.dataset.pressed = "";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    track(event);
  };
}

/** What gets the spring press: every button style, tabs, and anything marked data-press. */
export const PRESSABLE = '.btn, [class*="btn-"], .tab, [data-press]';

/** Installs the spring press for the whole page. Call once at startup. */
export function installPress(selector = PRESSABLE): () => void {
  const handlers = new WeakMap<HTMLElement, (event: PointerEvent) => void>();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const down = (event: PointerEvent) => {
    if (reduced.matches || !event.isPrimary || event.button !== 0) return;
    const el = (event.target as Element | null)?.closest?.(selector) as HTMLElement | null;
    if (!el || el.matches(':disabled, [aria-disabled="true"], [data-no-press], .lg-button') || el.closest(".lg-switch, .lg-segmented, .lg-tab-bar")) return;
    let handler = handlers.get(el);
    if (!handler) handlers.set(el, (handler = pressable(el)));
    handler(event);
  };
  document.addEventListener("pointerdown", down, { passive: true });
  return () => document.removeEventListener("pointerdown", down);
}
