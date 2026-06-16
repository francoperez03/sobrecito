import type { Variants } from 'motion/react'

// Shared motion language — Crisol-style ease-out, sober reveals, staggered cascades.
// transform + opacity + blur only (GPU-safe). Reduced-motion is handled at the
// component layer (Reveal / RevealGroup render static when the user opts out).

export const EASE_OUT = [0.16, 1, 0.3, 1] as const
export const EASE_BRAND = [0.32, 0.72, 0, 1] as const

export const DUR = {
  fast: 0.18,
  base: 0.32,
  medium: 0.56,
  slow: 0.8,
} as const

// Single block reveal (opacity + lift + de-blur), with optional delay.
export const revealUp = (delay = 0): Variants => ({
  hidden: { opacity: 0, y: 20, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: DUR.medium, ease: EASE_OUT, delay },
  },
})

// Child variant — driven by a parent staggerContainer (no own delay/trigger).
export const revealItem: Variants = {
  hidden: { opacity: 0, y: 18, filter: 'blur(5px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: DUR.medium, ease: EASE_OUT },
  },
}

// Parent that cascades its variant children into a waterfall.
export const staggerContainer = (stagger = 0.08, delayChildren = 0): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren } },
})
