'use client'

import { useRef } from 'react'
import { motion } from 'motion/react'
import { Eye, Key, type Icon } from '@phosphor-icons/react'

type TabValue = 'public' | 'auditor'

interface PillToggleProps {
  value: TabValue
  onChange: (value: TabValue) => void
}

const TABS: { value: TabValue; label: string; Icon: Icon }[] = [
  { value: 'public', label: 'Public', Icon: Eye },
  { value: 'auditor', label: 'Auditor', Icon: Key },
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
      // Dark, bordered track so the lighter active pill reads as a real segmented
      // control (the old bg-bg pill on bg-surface had near-zero contrast).
      className="relative flex gap-1 rounded-full bg-bg ring-1 ring-white/10 p-1 w-fit"
    >
      {TABS.map((tab, i) => {
        const isActive = value === tab.value
        const TabIcon = tab.Icon
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
              'relative z-10 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full text-sm font-medium transition-colors duration-200',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              isActive ? 'text-ink' : 'text-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {isActive && (
              <motion.span
                layoutId="pill-toggle-indicator"
                className="absolute inset-0 rounded-full bg-surface ring-1 ring-white/15 shadow-[inset_0_1px_1px_rgba(255,255,255,0.10)]"
                transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
              />
            )}
            <TabIcon
              size={14}
              weight={isActive ? 'fill' : 'regular'}
              className="relative z-10 shrink-0"
              aria-hidden
            />
            <span className="relative z-10">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
