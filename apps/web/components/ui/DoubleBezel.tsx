import type { ReactNode, ReactElement } from 'react'

interface DoubleBezelProps {
  children: ReactNode
  className?: string
  outerClassName?: string
  radius?: '1.5rem' | '2rem'
}

export function DoubleBezel({
  children,
  className,
  outerClassName,
  radius = '1.5rem',
}: DoubleBezelProps): ReactElement {
  const innerRadius = `calc(${radius} - 0.5rem)`

  return (
    <div
      className={`ring-1 ring-white/8 p-2 bg-surface ${outerClassName ?? ''}`}
      style={{ borderRadius: radius }}
    >
      <div
        className={`bg-bg shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] ${className ?? ''}`}
        style={{ borderRadius: innerRadius }}
      >
        {children}
      </div>
    </div>
  )
}
