/**
 * Design token constants from UI-SPEC.
 * These are reference values for use in components; the canonical CSS tokens
 * live in app/globals.css @theme{}.
 */

// Type scale (clamp strings for use with Tailwind arbitrary values)
export const typeScale = {
  display: 'clamp(3rem, 7vw, 5.5rem)',
  h2: 'clamp(1.75rem, 3.5vw, 2.75rem)',
  body: '1rem',
  small: '0.875rem',
} as const

// Spacing scale (in px, as multiples of 4)
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '48px',
  '3xl': '64px',
  '4xl': '96px',
  '5xl': '128px',
  '6xl': '160px',
} as const

// Typography weights
export const fontWeight = {
  body: 400,
  label: 500,
  display: 900,
} as const

// Line heights
export const lineHeight = {
  display: 1.05,
  heading: 1.15,
  body: 1.6,
  small: 1.4,
  code: 1.5,
} as const

// Letter spacing
export const letterSpacing = {
  display: '-0.02em',
  heading: '-0.01em',
  label: '0.02em',
} as const

// Custom easing
export const ease = {
  brand: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const

// Color token names (for reference; actual values in globals.css @theme{})
export const colorTokens = {
  bg: 'var(--color-bg)',
  surface: 'var(--color-surface)',
  ink: 'var(--color-ink)',
  inkMuted: 'var(--color-ink-muted)',
  accent: 'var(--color-accent)',
  accentWarm: 'var(--color-accent-warm)',
} as const
