'use client'

import { motion, useReducedMotion, type Variants } from 'motion/react'
import type { ElementType, ReactNode } from 'react'

const EASE_BRAND = [0.32, 0.72, 0, 1] as const

const revealVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 16,
    filter: 'blur(4px)',
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
  },
}

interface RevealProps {
  children: ReactNode
  delay?: number
  as?: ElementType
  className?: string
}

export function Reveal({ children, delay = 0, as: Tag = 'div', className }: RevealProps) {
  const prefersReducedMotion = useReducedMotion()

  // Under reduced-motion: render static, fully visible.
  // initial={false} means SSR renders the final visible state (no invisible flash).
  // The animation goes from visible → more visible (enhancement, not gating).
  if (prefersReducedMotion) {
    const El = Tag as ElementType
    return <El className={className}>{children}</El>
  }

  return (
    <motion.div
      className={className}
      // initial={false} ensures SSR + hydration renders the FINAL state.
      // whileInView triggers the reveal entrance when the element enters the viewport.
      // This is an enhancement: content is always visible; motion adds the entrance feel.
      initial={false}
      whileInView="visible"
      variants={revealVariants}
      transition={{
        duration: 0.75,
        ease: EASE_BRAND,
        delay,
        filter: { duration: 0.6, ease: EASE_BRAND, delay },
      }}
      viewport={{ once: true, margin: '-64px' }}
    >
      {children}
    </motion.div>
  )
}
