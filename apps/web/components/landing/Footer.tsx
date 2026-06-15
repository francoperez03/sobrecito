import { GithubLogo } from '@phosphor-icons/react/dist/ssr'

const GITHUB_REPO_URL = 'https://github.com/francoperez03/sobrecito'

export function Footer() {
  return (
    <footer className="py-16 px-4 border-t border-white/8">
      <div className="max-w-5xl mx-auto flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Wordmark + credit */}
        <div className="flex items-center gap-3">
          <span className="font-sans font-[900] text-ink tracking-[-0.02em]">
            Sobre
          </span>
          <span className="text-ink-muted font-sans text-sm">
            · by Crisol
          </span>
        </div>

        {/* GitHub link */}
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-ink-muted font-sans text-sm transition-opacity duration-200 hover:opacity-70 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none rounded"
        >
          <GithubLogo size={14} weight="light" />
          GitHub
        </a>
      </div>

      {/* Honest disclosure */}
      <div className="max-w-5xl mx-auto mt-6">
        <p className="font-sans text-[0.875rem] text-ink-muted leading-[1.4] tracking-[0.02em]">
          Proof-of-concept — not audited. Amounts shielded; batch totals proven on-chain.
        </p>
      </div>
    </footer>
  )
}
