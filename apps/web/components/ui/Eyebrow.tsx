import type { ReactElement, ReactNode } from 'react'

interface EyebrowProps {
  children: ReactNode
  className?: string
}

/**
 * Section eyebrow: a small mono label with a leading filled-square accent bullet.
 * Matches the existing eyebrow type scale (font-mono, uppercase, wide tracking).
 */
export function Eyebrow({ children, className = '' }: EyebrowProps): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-ink-muted ${className}`}
    >
      <span aria-hidden className="size-1.5 rounded-[2px] bg-accent" />
      {children}
    </span>
  )
}
