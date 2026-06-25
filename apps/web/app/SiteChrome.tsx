'use client'

import { MotionConfig } from 'motion/react'
import { FloatingNav } from '@/components/nav/FloatingNav'
import { WalletConnect } from '@/components/nav/WalletConnect'
import { DemoProgressPanel } from '@/components/progress/DemoProgressPanel'
import { Footer } from '@/components/landing/Footer'

// Shared site chrome mounted once at the root layout. Living above the
// (marketing)/(demo) route groups means FloatingNav is a single persistent
// instance that never remounts across navigations, so the dynamic-island
// role morph stays continuous when crossing route groups.
export function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-bg text-ink font-sans">
        <FloatingNav />
        <WalletConnect />
        <DemoProgressPanel />
        {children}
        <Footer />
      </div>
    </MotionConfig>
  )
}
