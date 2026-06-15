'use client'

import { useRef } from 'react'
import { motion } from 'motion/react'

type TabValue = 'public' | 'auditor'

interface PillToggleProps {
  value: TabValue
  onChange: (value: TabValue) => void
}

const TABS: { value: TabValue; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'auditor', label: 'Auditor' },
]

export function PillToggle({ value, onChange }: PillToggleProps) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // When the tablist div itself receives focus (e.g. from programmatic focus or
  // Playwright's `getByRole('tablist').focus()`), delegate to the active tab button.
  function handleTablistFocus(e: React.FocusEvent<HTMLDivElement>) {
    // Only redirect if focus landed directly on the tablist, not on a child
    if (e.target === e.currentTarget) {
      const activeIndex = TABS.findIndex((t) => t.value === value)
      tabRefs.current[activeIndex >= 0 ? activeIndex : 0]?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    let nextIndex: number | null = null

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (index + 1) % TABS.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (index - 1 + TABS.length) % TABS.length
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onChange(TABS[index].value)
      return
    } else {
      return
    }

    e.preventDefault()
    onChange(TABS[nextIndex].value)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="View mode"
      // tabIndex={-1} makes the container programmatically focusable so
      // Playwright's getByRole('tablist').focus() works in tests.
      tabIndex={-1}
      onFocus={handleTablistFocus}
      className="relative flex gap-1 rounded-full bg-surface p-1 w-fit"
    >
      {TABS.map((tab, i) => {
        const isActive = value === tab.value
        return (
          <button
            key={tab.value}
            ref={(el) => { tabRefs.current[i] = el }}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={[
              'relative z-10 min-h-[48px] px-5 rounded-full text-sm font-medium transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              isActive ? 'text-ink' : 'text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {isActive && (
              <motion.span
                layoutId="pill-toggle-indicator"
                className="absolute inset-0 rounded-full bg-bg shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]"
                transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
              />
            )}
            <span className="relative z-10">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
