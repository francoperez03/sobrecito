'use client'

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { MagnifyingGlass, Check, CaretDown, UserCircle } from '@phosphor-icons/react'
import { EASE_BRAND } from '@/lib/motion'
import { isValidEmployeePublicKey, type RosterEntry } from '@/lib/employeeRoster'

/**
 * EmployeeKeyField — one field that does both jobs for the "Public key" column:
 *
 *   1. Load text:   paste / type the employee's 128-hex public key directly.
 *   2. Search the library: type an alias to filter the saved roster (the library
 *      the employee populated on their console) and pick an entry with mouse or
 *      keyboard. Selecting fills in that employee's public key.
 *
 * The value the parent stores IS the public key string. When that value matches a
 * saved roster entry, the alias is shown inline so the employer confirms WHO they
 * are paying instead of staring at an opaque hex blob.
 *
 * The dropdown is rendered through a portal with fixed positioning so it is never
 * clipped by the table's overflow/stacking context.
 */

export interface EmployeeKeyFieldProps {
  /** Current public-key value for this row. */
  value: string
  /** Commit a new public-key value (selection or manual edit). */
  onChange: (value: string) => void
  /** The saved employee library. Empty → the field is a plain key input. */
  roster: RosterEntry[]
  /** Row index — used for stable ids / test hooks. */
  rowIndex: number
}

/** Shorten a 128-hex key for display: first 8 + ellipsis + last 6. */
function shortKey(key: string): string {
  const clean = key.trim().replace(/^0x/, '')
  if (clean.length <= 18) return clean
  return `${clean.slice(0, 8)}…${clean.slice(-6)}`
}

export function EmployeeKeyField({
  value,
  onChange,
  roster,
  rowIndex,
}: EmployeeKeyFieldProps) {
  const reduceMotion = useReducedMotion()
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-opt-${i}`

  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  // Fixed-position rect for the portaled dropdown.
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)

  const hasRoster = roster.length > 0
  const normalized = value.trim().replace(/^0x/, '').toLowerCase()
  const isValid = isValidEmployeePublicKey(value)

  // The saved entry this value resolves to (if any) — drives the inline alias badge.
  const matchedEntry = useMemo(
    () => roster.find((e) => e.publicKey.trim().replace(/^0x/, '').toLowerCase() === normalized),
    [roster, normalized],
  )

  // Library matches for the current text. Empty value → the whole library.
  // A value that already resolves to a saved entry isn't a "search", so the list
  // collapses to that single confirmed entry.
  const matches = useMemo(() => {
    if (matchedEntry) return [matchedEntry]
    const q = value.trim().toLowerCase()
    if (q === '') return roster
    return roster.filter(
      (e) =>
        e.alias.toLowerCase().includes(q) ||
        e.publicKey.toLowerCase().includes(q),
    )
  }, [roster, value, matchedEntry])

  // Show the invalid-key warning only once the user has left the field, so typing
  // an alias to search doesn't flash an error mid-search.
  const showError = !focused && value.trim() !== '' && !isValid

  // Keep the active option in range whenever the match set changes.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, matches.length - 1)))
  }, [matches.length])

  // Position the portaled dropdown under the input; track scroll + resize.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const el = inputRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({ top: r.bottom + 6, left: r.left, width: r.width })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open])

  // Close on outside pointer-down (the input + portal listbox are the inside).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (document.getElementById(listboxId)?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, listboxId])

  function commit(entry: RosterEntry) {
    onChange(entry.publicKey)
    setOpen(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!hasRoster) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setActive((a) => (matches.length ? (a + 1) % matches.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return
      setActive((a) => (matches.length ? (a - 1 + matches.length) % matches.length : 0))
    } else if (e.key === 'Enter') {
      if (open && matches[active]) {
        e.preventDefault()
        commit(matches[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
      }
    }
  }

  function handleBlur() {
    setFocused(false)
    setOpen(false)
    // Convenience: if the typed text is the exact alias of a single saved
    // employee (and not already a valid key), adopt that employee on the way out.
    if (!isValid) {
      const q = value.trim().toLowerCase()
      const exact = roster.filter((e) => e.alias.toLowerCase() === q)
      if (q !== '' && exact.length === 1) onChange(exact[0].publicKey)
    }
  }

  return (
    <div ref={wrapRef} className="relative flex flex-col gap-1 min-w-0">
      <div className="relative flex items-center">
        {hasRoster && (
          <MagnifyingGlass
            size={14}
            weight="bold"
            aria-hidden
            className="pointer-events-none absolute left-0 text-ink-muted/50"
          />
        )}
        <input
          ref={inputRef}
          type="text"
          role={hasRoster ? 'combobox' : undefined}
          aria-expanded={hasRoster ? open : undefined}
          aria-controls={hasRoster ? listboxId : undefined}
          aria-autocomplete={hasRoster ? 'list' : undefined}
          aria-activedescendant={open && matches[active] ? optionId(active) : undefined}
          aria-invalid={showError || undefined}
          data-testid={`employee-key-input`}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder={
            hasRoster
              ? 'Paste a payment address or search saved employees'
              : "Paste the employee's payment address"
          }
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (hasRoster) setOpen(true)
          }}
          onFocus={() => {
            setFocused(true)
            if (hasRoster) setOpen(true)
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={[
            'font-mono text-sm bg-transparent border-b outline-none py-1 w-full min-w-0 transition-colors',
            // Pad left for the search icon, right for the trailing affordance.
            hasRoster ? 'pl-5' : '',
            matchedEntry || isValid ? 'pr-7' : 'pr-5',
            value && !isValid ? 'text-ink' : 'text-ink-muted',
            showError
              ? 'border-accent-warm/70 focus:border-accent-warm'
              : 'border-white/10 focus:border-accent',
          ].join(' ')}
        />

        {/* Trailing affordance: confirmed-key check, or a caret to open the library. */}
        <span className="pointer-events-none absolute right-0 flex items-center">
          {isValid ? (
            <Check size={15} weight="bold" aria-hidden className="text-accent-soft" />
          ) : hasRoster ? (
            <motion.span
              animate={{ rotate: open ? 180 : 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.25, ease: EASE_BRAND }}
              className="flex text-ink-muted/50"
            >
              <CaretDown size={13} weight="bold" aria-hidden />
            </motion.span>
          ) : null}
        </span>
      </div>

      {/* Inline confirmation: who this key belongs to. The whole point of the
          library — a 128-hex blob means nothing; the alias confirms identity. */}
      {matchedEntry && (
        <span className="flex items-center gap-1 text-xs text-accent-soft">
          <UserCircle size={13} weight="fill" aria-hidden />
          <span className="truncate">Paying {matchedEntry.alias}</span>
        </span>
      )}

      {showError && !matchedEntry && (
        <span className="text-xs text-accent-warm">
          Not a valid payment address. Paste it again, or pick a saved employee.
        </span>
      )}

      {/* Library dropdown — portaled + fixed so the table never clips it. */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && hasRoster && rect && (
              <motion.div
                id={listboxId}
                role="listbox"
                aria-label="Saved employees"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: reduceMotion ? 0.12 : 0.18, ease: EASE_BRAND }}
                style={{
                  position: 'fixed',
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  zIndex: 50,
                }}
                className="max-h-64 overflow-auto rounded-xl bg-surface ring-1 ring-hairline-strong shadow-[0_12px_40px_rgba(0,0,0,0.55)] p-1"
              >
                {matches.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-ink-muted">
                    No saved employee matches “{value.trim()}”. Keep typing to paste an address.
                  </p>
                ) : (
                  matches.map((entry, i) => {
                    const isActive = i === active
                    const isCurrent = entry === matchedEntry
                    return (
                      <button
                        key={entry.alias}
                        id={optionId(i)}
                        role="option"
                        aria-selected={isCurrent}
                        type="button"
                        // Use mousedown so the click lands before the input blur closes us.
                        onMouseDown={(e) => {
                          e.preventDefault()
                          commit(entry)
                        }}
                        onMouseEnter={() => setActive(i)}
                        className={[
                          'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                          isActive ? 'bg-white/8' : 'hover:bg-white/5',
                        ].join(' ')}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-1.5 text-sm text-ink truncate">
                            {entry.alias}
                            {isCurrent && (
                              <Check size={12} weight="bold" aria-hidden className="text-accent-soft" />
                            )}
                          </span>
                          <span className="font-mono text-[11px] text-ink-muted/70 truncate">
                            {shortKey(entry.publicKey)}
                          </span>
                        </span>
                      </button>
                    )
                  })
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}
