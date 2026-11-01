/**
 * Motion helpers. Everything animates through these so "Reduce Motion" (iOS Settings →
 * Accessibility → Motion) turns animations off everywhere.
 *
 *   <li transition:fly={{ y: 8, duration: dur(MOTION.fast), easing: easeOut }}>
 *   <div transition:collapse>
 */
import type { TransitionConfig } from 'svelte/transition';

const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined;

/** Durations in ms, the same as --dur-press, --dur-fast, --dur and --dur-slow in app.css. */
export const MOTION = { press: 90, fast: 160, base: 220, slow: 300 } as const;

export function reducedMotion(): boolean {
  return !!query?.matches;
}

/** Duration in ms, or 0 when the user prefers reduced motion. */
export function dur(ms: number): number {
  return reducedMotion() ? 0 : ms;
}

function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let low = 0;
    let high = 1;
    for (let i = 0; i < 14; i++) {
      const s = (low + high) / 2;
      if (at(x1, x2, s) < t) low = s;
      else high = s;
    }
    return at(y1, y2, (low + high) / 2);
  };
}

/** The decelerating curve of var(--ease), for JS-driven animations. */
export const easeOut = bezier(0.2, 0.8, 0.2, 1);

/**
 * Slides in from below the screen and back out. It starts from where the element is now, so a
 * dragged sheet leaves from under the finger.
 */
export function slideUp(node: HTMLElement, { duration = MOTION.slow }: { duration?: number } = {}): TransitionConfig {
  const distance = Math.max(0, window.innerHeight - node.getBoundingClientRect().top);
  const transform = getComputedStyle(node).transform;
  const base = transform === 'none' ? '' : transform;
  return {
    duration: dur(duration),
    easing: easeOut,
    css: (_t, u) => `transform: ${base} translate3d(0, ${u * distance}px, 0)`,
  };
}

/**
 * Opens from no height and closes to none, for rows the content below has to move for. `clip`
 * rather than `hidden`, because scrollIntoView can scroll a hidden box from inside. Svelte puts the
 * overflow back when the intro ends.
 */
export function collapse(node: HTMLElement, { duration = MOTION.base }: { duration?: number } = {}): TransitionConfig {
  const height = node.getBoundingClientRect().height;
  const ms = dur(duration);
  if (ms) node.style.overflow = 'clip';
  return {
    duration: ms,
    easing: easeOut,
    css: (t) => `height: ${t * height}px; opacity: ${t}`,
  };
}
