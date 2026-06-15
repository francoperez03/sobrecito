# Design

## Color

Strategy: **Committed** — one saturated color (electric blue) carries ~10% of the surface as the brand signal. The substrate is a tinted blue-black ("colored black", not pure black): a whisper of blue undertone in the dark ground makes the electric-blue accent read as luminous proof. Amber accent reserved exclusively for the exposure/danger signal (its warmth is the one complementary note against the cool field).

Physical-scene sentence: "A payroll officer in a well-lit corporate back office works at a terminal at night. The room is dim. The screen is the only source of light. The envelope on the desk is sealed."

### Palette

| Role | Value | Usage |
|------|-------|-------|
| bg | `oklch(0.14 0.020 262)` | Page background, 60% — tinted blue-black (colored, not pure black) |
| surface | `oklch(0.20 0.028 262)` | Cards, sealed envelope state, nav pill bg — 30% |
| ink | `oklch(0.96 0.012 258)` | Primary body text, headings |
| ink-muted | `oklch(0.74 0.030 258)` | Captions, metadata, secondary labels |
| accent | `oklch(0.60 0.220 258)` | Electric blue — large headings/icons + focus rings (>=3:1) |
| accent-soft | `oklch(0.80 0.150 252)` | Lighter blue — small accent text on dark (AA 4.5:1) |
| accent-fill | `oklch(0.50 0.200 260)` | Deep blue — button fills with white text (AA 4.5:1) |
| accent-warm | `oklch(0.80 0.130 60)` | Amber — named-salary anchor only, exposure signal |

Contrast verification targets (verified green via axe-core in tests/a11y.spec.ts):
- ink on bg: ≥7:1 (WCAG AAA)
- ink-muted on bg: ≥4.5:1 (WCAG AA)
- accent on bg AND dark text on accent fills: ≥4.5:1 (accent L tuned to 0.72 so it passes in both directions)
- accent-warm on bg: ≥4.5:1

## Typography

Single family system: **Geist** (Vercel, via next/font/google).

Scale is a single source of truth in `@theme` (globals.css): `--text-display/h2/h3/lead`
generate the `text-display`/`text-h2`/`text-h3`/`text-lead` utilities. No inline
`style={{ fontSize }}` — components reference the named token.

| Role | Token / Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Display / H1 | `text-display` = clamp(3rem, 6.5vw, 5.25rem) | 900 | 1.05 | -0.02em |
| Heading / H2 | `text-h2` = clamp(2rem, 3.8vw, 3rem) | 900 | 1.15 | -0.01em |
| Subheading / H3 | `text-h3` = clamp(1.375rem, 2vw, 1.75rem) | 900 | 1.15 | -0.01em |
| Lead / subhead | `text-lead` = clamp(1.125rem, 1.7vw, 1.375rem) | 400 | 1.6 | 0 |
| Body | 1rem (16px) | 400 | 1.6 | 0 |
| Small / Label | 0.875rem (14px) | 400–500 (label) | 1.4 | 0.02em |
| Small / Code | 0.875rem (14px) | 400 (Geist Mono) | 1.5 | 0 |

No serif. No PP Editorial New. Geist Mono scoped to hashes, predicates, and code snippets only.
Display letter-spacing held at -0.02em (above the -0.04em cramped floor).

## Spacing

Base unit: 4px. Section padding minimum: py-24 (96px). Hero: pt-40 pb-32.

| Token | Value |
|-------|-------|
| xs | 4px |
| sm | 8px |
| md | 16px |
| lg | 24px |
| xl | 32px |
| 2xl | 48px |
| 3xl | 64px |
| 4xl | 96px |
| 5xl | 128px |
| 6xl | 160px |

## Components

### DoubleBezel
Every card, centerpiece container, and three-levels cell uses the nested architecture:
- Outer shell: `ring-1 ring-white/8 p-2 bg-surface rounded-[1.5rem]`
- Inner core: `bg-bg shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)] rounded-[calc(1.5rem-0.5rem)]`

### Toggle/Centerpiece
Pill with two tabs ("Public" / "Auditor"). Sliding background indicator. Clip-path reveal on amounts (600ms, cubic-bezier(0.32, 0.72, 0, 1)). MotionConfig reducedMotion="user" wraps the entire centerpiece.

### Nav
Floating glass pill. No sticky full-width navbar. Left: wordmark. Right: primary CTA + ghost GitHub link.

## Motion

Custom easing: `cubic-bezier(0.32, 0.72, 0, 1)`

All animations on transform + opacity only. No layout properties. prefers-reduced-motion: instant crossfade.

## Layout

Archetype: Z-Axis Cascade — elements stack like physical layers with varying depth.

Route groups:
- `(marketing)/` — landing page, brand register
- `(demo)/employer` and `(demo)/auditor` — Phase 6, product register

Max content width: varies by section. Centerpiece: max-w-3xl centered. Prose: max-w-[65ch].
