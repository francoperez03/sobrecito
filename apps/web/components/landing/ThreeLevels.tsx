import { ChartBar, Lock, Eye } from '@phosphor-icons/react/dist/ssr'
import { DoubleBezel } from '@/components/ui/DoubleBezel'

const levels = [
  {
    label: 'Employer',
    copy: 'You see the breakdown.',
    icon: ChartBar,
    iconColor: 'text-accent',
  },
  {
    label: 'Public',
    copy: 'They see the total, proven.',
    icon: Eye,
    iconColor: 'text-ink-muted',
  },
  {
    label: 'Auditor',
    copy: 'Auditor reconstructs detail via view-key.',
    icon: Lock,
    iconColor: 'text-accent',
  },
] as const

export function ThreeLevels() {
  return (
    <section className="py-32 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {levels.map(({ label, copy, icon: Icon, iconColor }) => (
            <DoubleBezel key={label}>
              <div className="p-8 flex flex-col gap-4">
                {/* Inline icon — no large rounded container */}
                <div className="flex items-center gap-2">
                  <Icon size={24} weight="light" className={iconColor} />
                  <span className="font-sans font-[500] text-[0.875rem] text-ink-muted leading-[1.4] tracking-[0.02em] uppercase">
                    {label}
                  </span>
                </div>
                <p className="font-sans font-[400] text-ink text-base leading-[1.6]">
                  {copy}
                </p>
              </div>
            </DoubleBezel>
          ))}
        </div>
      </div>
    </section>
  )
}
