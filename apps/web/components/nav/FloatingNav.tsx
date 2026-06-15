'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowRight, GithubLogo } from '@phosphor-icons/react'

const GITHUB_REPO_URL = 'https://github.com/francoperez03/sobrecito'
const DEMO_VIDEO_URL = '#demo'
const EASE_OUT = [0.16, 1, 0.3, 1] as const
const EASE_BRAND = [0.32, 0.72, 0, 1] as const

const NAV_LINKS = [
  { label: 'Watch the demo', href: DEMO_VIDEO_URL, primary: true },
  { label: 'View on GitHub', href: GITHUB_REPO_URL, external: true },
]

export function FloatingNav() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <nav className="flex justify-center pt-6 px-4 relative z-50">
        <div className="flex items-center gap-4 h-12 pl-5 pr-2 bg-surface/80 ring-1 ring-hairline rounded-full backdrop-blur-md">
          {/* Wordmark */}
          <span className="font-display font-light text-ink tracking-[-0.02em] text-lg">
            sobrecito
          </span>

          <div className="flex-1" />

          {/* Desktop: Watch the demo CTA */}
          <a
            href={DEMO_VIDEO_URL}
            className="hidden md:flex items-center gap-1.5 px-4 h-9 bg-accent-fill text-white font-sans font-medium text-sm rounded-full transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            rel="noopener noreferrer"
          >
            Watch the demo
            <ArrowRight size={16} weight="light" />
          </a>

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
            {NAV_LINKS.map(({ label, href, external, primary }, i) => (
              <motion.a
                key={label}
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                className={`font-display font-light text-3xl tracking-[-0.02em] transition-opacity hover:opacity-70 ${
                  primary ? 'text-accent-soft' : 'text-ink-muted'
                }`}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{
                  duration: 0.3,
                  ease: EASE_OUT,
                  delay: 0.05 + i * 0.08,
                }}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
