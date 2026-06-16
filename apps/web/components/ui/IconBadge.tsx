import type { ReactElement } from 'react'
import type { Icon } from '@phosphor-icons/react'

interface IconBadgeProps {
  icon: Icon
  /** `accent` = accent-tinted fill + accent icon; `muted` = surface fill + muted icon. */
  tone?: 'accent' | 'muted'
  className?: string
}

/**
 * Filled rounded-square badge wrapping a Phosphor icon. Dark-theme adaptation of
 * the institutional icon-badge pattern: accent-tinted fill, hairline ring, and the
 * same inset top-highlight as DoubleBezel's inner panel. Decorative (aria-hidden);
 * meaning is carried by the adjacent visible label.
 */
export function IconBadge({
  icon: Icon,
  tone = 'accent',
  className = '',
}: IconBadgeProps): ReactElement {
  const isAccent = tone === 'accent'
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center size-10 rounded-xl ring-1 ring-hairline shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] ${
        isAccent ? 'bg-accent/10' : 'bg-surface'
      } ${className}`}
    >
      <Icon size={20} weight="light" className={isAccent ? 'text-accent' : 'text-ink-muted'} />
    </span>
  )
}
