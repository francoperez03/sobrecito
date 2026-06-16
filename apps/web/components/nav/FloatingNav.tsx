'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { CaretDown, GithubLogo } from '@phosphor-icons/react'

const GITHUB_REPO_URL = 'https://github.com/francoperez03/sobrecito'
const EASE_BRAND = [0.32, 0.72, 0, 1] as const
// Dynamic-Island spring for the role-pill morph.
const ISLAND_SPRING = { type: 'spring', stiffness: 440, damping: 32, mass: 0.7 } as const

/** Map the current route to the role being "played", or null on the root/marketing page. */
function roleFromPath(pathname: string): string | null {
  if (pathname.startsWith('/employer')) return 'Employer'
  if (pathname.startsWith('/employee')) return 'Employee'
  if (pathname.startsWith('/auditor')) return 'Auditor'
  return null
}

// Pre-generated demo claim token (one note of the live testnet batch) so
// "Play as → Employee" opens a real claim card instead of the invalid-link state.
const EMPLOYEE_DEMO_TOKEN =
  'eyJwb29sQ29udHJhY3RJZCI6IkNESEo2VzVaQ0s3U1RORUQ3QVQ3U0tDVVJRREZWQ0ZKTDZaQkY2WFc3UU1QT0lCS0hBT0xDVkwyIiwiY29tbWl0bWVudEluZGV4IjoyMCwiYW1vdW50IjoiMjUwMDAwMCIsIm5vdGVQcml2a2V5SGV4IjoiMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMCIsImJsaW5kaW5nIjoiMzAwNCJ9'

// The three demo surfaces. "Play as" lets a visitor step into each role.
const PLAY_AS = [
  { label: 'Employer', href: '/employer' },
  { label: 'Employee', href: `/employee/${EMPLOYEE_DEMO_TOKEN}` },
  { label: 'Auditor', href: '/auditor' },
]

export function FloatingNav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [playOpen, setPlayOpen] = useState(false)
  const playRef = useRef<HTMLDivElement>(null)
  const activeRole = roleFromPath(usePathname() ?? '/')

  // Close the Play-as dropdown on outside click or Escape.
  useEffect(() => {
    if (!playOpen) return
    function onPointerDown(e: PointerEvent) {
      if (playRef.current && !playRef.current.contains(e.target as Node)) {
        setPlayOpen(false)
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPlayOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [playOpen])

  return (
    <>
      <nav className="flex justify-center pt-6 px-4 relative z-50">
        <div className="flex items-center gap-4 h-12 pl-5 pr-2 bg-surface/80 ring-1 ring-hairline rounded-full backdrop-blur-md">
          {/* Wordmark — tapping the root shrinks the island back to its natural state */}
          <Link
            href="/"
            className="font-display font-light text-ink tracking-[-0.02em] text-lg rounded transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            sobrecito
          </Link>

          <div className="flex-1" />

          {/* Desktop: Play as dropdown */}
          <div ref={playRef} className="hidden md:block relative">
            <motion.button
              layout
              transition={ISLAND_SPRING}
              type="button"
              aria-haspopup="menu"
              aria-expanded={playOpen}
              aria-label={activeRole ? `Playing as ${activeRole}` : 'Play as'}
              onClick={() => setPlayOpen((prev) => !prev)}
              className="flex items-center gap-1.5 pl-4 pr-3 h-[44px] bg-accent-fill text-white font-sans font-[900] text-sm rounded-full hover:opacity-90 active:scale-[0.98]"
            >
              <motion.span layout="position" className="whitespace-nowrap">
                Play as
              </motion.span>

              {/* Dynamic-island: the active role grows in as continuous text so it
                  reads "Play as Employer"; pops back out at the root. */}
              <AnimatePresence initial mode="popLayout">
                {activeRole && (
                  <motion.span
                    key={activeRole}
                    layout
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.4 }}
                    transition={ISLAND_SPRING}
                    className="whitespace-nowrap origin-left"
                  >
                    {activeRole}
                  </motion.span>
                )}
              </AnimatePresence>

              <motion.span
                layout="position"
                animate={{ rotate: playOpen ? 180 : 0 }}
                transition={{ duration: 0.3, ease: EASE_BRAND }}
                className="flex"
              >
                <CaretDown size={16} weight="bold" />
              </motion.span>
            </motion.button>

            <AnimatePresence>
              {playOpen && (
                <motion.div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+8px)] min-w-[176px] p-1.5 bg-surface ring-1 ring-white/8 rounded-2xl backdrop-blur-sm shadow-xl shadow-black/40 origin-top-right"
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: EASE_BRAND }}
                >
                  {PLAY_AS.map(({ label, href }, i) => {
                    const isActive = label === activeRole
                    return (
                      <motion.a
                        key={label}
                        href={href}
                        role="menuitem"
                        aria-current={isActive ? 'page' : undefined}
                        className={`flex items-center justify-between px-3.5 h-[40px] rounded-xl font-sans font-[700] text-sm transition-colors ${
                          isActive
                            ? 'text-accent-soft bg-accent/10'
                            : 'text-ink-muted hover:text-ink hover:bg-white/5'
                        }`}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: 0.22,
                          ease: EASE_BRAND,
                          delay: 0.03 + i * 0.05,
                        }}
                        onClick={() => setPlayOpen(false)}
                      >
                        {label}
                        {isActive && <span className="size-1.5 rounded-full bg-accent-soft" aria-hidden />}
                      </motion.a>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {/* Desktop: View on GitHub ghost link */}
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-1.5 px-3 h-9 text-ink-muted font-sans text-sm rounded-full transition-colors duration-200 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            <GithubLogo size={16} weight="light" />
            View on GitHub
          </a>

          {/* Mobile hamburger — morphs to X on open */}
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((prev) => !prev)}
            className="md:hidden flex flex-col justify-center items-center gap-[5px] w-[44px] h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 rounded-full"
          >
            {/* Top line — rotates +45deg when open */}
            <motion.span
              className="block w-5 h-px bg-ink rounded-full origin-center"
              animate={menuOpen ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_BRAND }}
            />
            {/* Middle line — fades out when open */}
            <motion.span
              className="block w-5 h-px bg-ink rounded-full"
              animate={menuOpen ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
              transition={{ duration: 0.2, ease: EASE_BRAND }}
            />
            {/* Bottom line — rotates -45deg when open */}
            <motion.span
              className="block w-5 h-px bg-ink rounded-full origin-center"
              animate={menuOpen ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_BRAND }}
            />
          </button>
        </div>
      </nav>

      {/* Mobile full-screen overlay menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            className="fixed inset-0 z-40 backdrop-blur-3xl bg-black/85 flex flex-col items-center justify-center gap-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE_BRAND }}
          >
            <motion.span
              className="text-xs uppercase tracking-[0.2em] text-ink-muted/60"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: EASE_BRAND, delay: 0.05 }}
            >
              Play as
            </motion.span>
            {PLAY_AS.map(({ label, href }, i) => (
              <motion.a
                key={label}
                href={href}
                className="font-sans font-[900] text-2xl tracking-[-0.02em] text-accent-soft transition-opacity hover:opacity-70"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{
                  duration: 0.3,
                  ease: EASE_BRAND,
                  delay: 0.1 + i * 0.08,
                }}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </motion.a>
            ))}
            <motion.a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans font-[900] text-2xl tracking-[-0.02em] text-ink-muted transition-opacity hover:opacity-70"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: EASE_BRAND, delay: 0.1 + PLAY_AS.length * 0.08 }}
              onClick={() => setMenuOpen(false)}
            >
              View on GitHub
            </motion.a>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
