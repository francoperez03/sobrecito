import { GithubLogo } from '@phosphor-icons/react/dist/ssr'

const GITHUB_REPO_URL = 'https://github.com/francoperez03/sobrecito'

export function Footer() {
  return (
    <footer className="py-20 px-5 md:px-8 border-t border-hairline bg-surface-deep">
      <div className="max-w-5xl mx-auto flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        {/* Wordmark + credit */}
        <div className="flex items-baseline gap-3">
          <span className="font-display font-light text-ink text-4xl md:text-5xl tracking-[-0.02em]">
            sobrecito
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-muted">
            by Crisol
          </span>
        </div>

        {/* GitHub link */}
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-ink-muted font-mono text-xs uppercase tracking-[0.18em] transition-colors duration-200 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:outline-none rounded"
        >
          <GithubLogo size={15} weight="light" />
          GitHub
        </a>
      </div>
    </footer>
  )
}
