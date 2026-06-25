'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { GithubLogo } from '@phosphor-icons/react'

const GITHUB_REPO_URL = 'https://github.com/francoperez03/sobrecito'
const EASE_BRAND = [0.32, 0.72, 0, 1] as const
// Spring for the sliding role pill (segmented control highlight).
const ISLAND_SPRING = { type: 'spring', stiffness: 440, damping: 32, mass: 0.7 } as const

// Animated Next.js Link: role switches navigate client-side (no full reload),
// so the persistent navbar stays mounted and the pill slides across the route
// change instead of remounting on a hard navigation.
const MotionLink = motion.create(Link)

// The three demo surfaces, shown as a segmented control. The sliding pill
// highlights the active one and fades out on the root/marketing page.
// Employee points straight at the stable-key dashboard. The old per-token route
// (/employee/[token]) was retired in 06.3 and only redirects here, so linking it
// produced a long token URL that bounced to /employee — link /employee directly.
const ROLES = [
  { label: 'Pay', href: '/employer' },
  { label: 'Receive', href: '/employee' },
  { label: 'Audit', href: '/auditor' },
]

/** The href of the role being "played", or null on the root/marketing page. */
function activeHrefFromPath(pathname: string): string | null {
  return ROLES.find((r) => pathname.startsWith(r.href))?.href ?? null
}

export function FloatingNav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const pathname = usePathname() ?? '/'
  const activeHref = activeHrefFromPath(pathname)

  // A role tab was tapped: close the mobile overlay. Navigation is client-side,
  // so the navbar stays mounted and the pill slides via its shared layoutId.
  function handleRoleNav() {
    setMenuOpen(false)
  }

  return (
    <>
      {/* pointer-events-none: the bar is full-width but only the centered pill is
          interactive, so its empty strip must not swallow clicks on content
          beneath it (e.g. the top-left progress launcher). */}
      <nav className="flex justify-center pt-6 px-4 sticky top-0 z-50 pointer-events-none">
        <div className="flex items-center gap-4 h-12 pl-5 pr-2 bg-surface/80 ring-1 ring-hairline rounded-full backdrop-blur-md pointer-events-auto">
          {/* Wordmark — tapping it returns to the root, where the role pill fades out */}
          <Link
            href="/"
            className="font-display font-light text-ink tracking-[-0.02em] text-lg rounded transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            sobrecito
          </Link>

          <div className="flex-1" />

          {/* Desktop: role segmented control. A single pill (shared layoutId)
              slides between tabs as the route changes, and fades out on the
              root/marketing page where no tab is active. */}
          <div className="hidden md:flex items-center gap-1" role="tablist" aria-label="Play as">
            {ROLES.map(({ label, href }) => {
              const isActive = href === activeHref
              return (
                <MotionLink
                  key={label}
                  href={href}
                  role="tab"
                  aria-selected={isActive}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={handleRoleNav}
                  className={`relative flex items-center justify-center px-4 h-[36px] rounded-full font-sans font-[900] text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                    isActive ? 'text-white' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  <AnimatePresence>
                    {isActive && (
                      <motion.span
                        layoutId="nav-role-pill"
                        className="absolute inset-0 -z-0 bg-accent-fill rounded-full"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ layout: ISLAND_SPRING, opacity: { duration: 0.35, ease: EASE_BRAND } }}
                      />
                    )}
                  </AnimatePresence>
                  <span className="relative z-10 whitespace-nowrap">{label}</span>
                </MotionLink>
              )
            })}
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
            {ROLES.map(({ label, href }, i) => (
              <MotionLink
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
                onClick={handleRoleNav}
              >
                {label}
              </MotionLink>
            ))}
            <motion.a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans font-[900] text-2xl tracking-[-0.02em] text-ink-muted transition-opacity hover:opacity-70"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.3, ease: EASE_BRAND, delay: 0.1 + ROLES.length * 0.08 }}
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
