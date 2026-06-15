import type { Metadata } from 'next'
import { Geist, Geist_Mono, Fraunces } from 'next/font/google'
import './globals.css'

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

// Fraunces — display serif (light optical weights) for editorial headlines.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  weight: ['300', '400', '500'],
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  title: 'sobrecito · payroll that doesn\'t dox your team',
  description:
    'Pay salaries in USDC on-chain. Keep every amount private. Still prove the totals to your auditor.',
  icons: {
    icon: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${fraunces.variable}`}
    >
      {/* suppressHydrationWarning: browser extensions inject attributes on <body>
          (e.g. bis_register / __processed_*) before hydration; this silences that
          extension-only noise without affecting app markup. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
