'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'motion/react'
import type { ElementType, ReactNode } from 'react'
import { revealUp, revealItem, staggerContainer } from '@/lib/motion'

// Reveal pattern — enhance an already-visible default (never ship blank).
//   - SSR + first client paint: rendered VISIBLE (initial={false}, animate="visible").
//   - After mount: below-the-fold blocks arm to "hidden" (unseen) and animate in when
//     scrolled into view; above-the-fold blocks stay visible.
//   - Reduced motion: static, fully visible.
function useArmedState(margin: `${number}px`) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin })
  const [mounted, setMounted] = useState(false)
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    setMounted(true)
    const el = ref.current
    // Anything already in or above the viewport at load shows immediately — no
    // gating, no fade-out flash, and robust to mid-page scroll restoration.
    if (el && el.getBoundingClientRect().top < window.innerHeight * 0.9) {
      setRevealed(true)
    }
  }, [])
  // Until mounted, force "visible" so SSR/first paint is never blank.
  const state = !mounted || inView || revealed ? 'visible' : 'hidden'
  return { ref, state }
}

interface RevealProps {
  children: ReactNode
  delay?: number
  className?: string
  margin?: `${number}px`
}

export function Reveal({ children, delay = 0, className, margin = '-80px' }: RevealProps) {
  const prefersReducedMotion = useReducedMotion()
  const { ref, state } = useArmedState(margin)

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={false}
      animate={state}
      variants={revealUp(delay)}
    >
      {children}
    </motion.div>
  )
}

interface RevealGroupProps {
  children: ReactNode
  className?: string
  stagger?: number
  delay?: number
  margin?: `${number}px`
}

export function RevealGroup({
  children,
  className,
  stagger = 0.09,
  delay = 0,
  margin = '-80px',
}: RevealGroupProps) {
  const prefersReducedMotion = useReducedMotion()
  const { ref, state } = useArmedState(margin)

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={false}
      animate={state}
      variants={staggerContainer(stagger, delay)}
    >
      {children}
    </motion.div>
  )
}

interface RevealItemProps {
  children: ReactNode
  className?: string
  as?: ElementType
}

export function RevealItem({ children, className, as = 'div' }: RevealItemProps) {
  const MotionTag = motion[as as keyof typeof motion] as typeof motion.div
  return (
    <MotionTag className={className} variants={revealItem}>
      {children}
    </MotionTag>
  )
}
