import type { Transition, Variants } from "motion/react";

/**
 * Motion tokens — the single source of truth for how things move in Ledgerly.
 * CSS equivalents live in globals.css (--ease-out-quint, --animate-*).
 *
 * Rules of thumb (see docs/stage-02-design-system.md §6):
 *  - UI feedback (hover, press) ≤ 150 ms. Entrances 200–400 ms. Nothing over 600 ms.
 *  - Things ENTER with ease-out (fast then settle) and EXIT faster with ease-in.
 *  - Springs for anything the user directly manipulates or that moves position;
 *    they feel physical and can be interrupted mid-flight without a jump.
 */
export const duration = {
  instant: 0.1,
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;

export const ease = {
  outQuint: [0.22, 1, 0.36, 1],
  outExpo: [0.16, 1, 0.3, 1],
  inOutQuart: [0.76, 0, 0.24, 1],
} as const satisfies Record<string, [number, number, number, number]>;

export const spring = {
  /** Quick and crisp, no overshoot — layout shifts, toggles, reordering. */
  snappy: { type: "spring", stiffness: 500, damping: 40, mass: 1 },
  /** Softer settle — cards and panels entering. */
  smooth: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
  /** A little overshoot — playful confirmations (use sparingly!). */
  bouncy: { type: "spring", stiffness: 400, damping: 18, mass: 0.8 },
} as const satisfies Record<string, Transition>;

/** Fade + rise, used for content appearing on screen. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: duration.slow, ease: ease.outQuint },
  },
};

/** Parent variant that reveals its children one after another. */
export const stagger = (staggerChildren = 0.05, delayChildren = 0): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren, delayChildren } },
});
