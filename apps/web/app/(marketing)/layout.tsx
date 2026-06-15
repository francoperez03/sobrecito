import { MotionConfig } from 'motion/react'
import { FloatingNav } from '@/components/nav/FloatingNav'
import { Footer } from '@/components/landing/Footer'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh bg-bg text-ink font-sans">
        <FloatingNav />
        {children}
        <Footer />
      </div>
    </MotionConfig>
  )
}
