export function WhyStellar() {
  return (
    <section className="py-32 px-4">
      <div className="max-w-5xl mx-auto">
        <h2
          className="font-sans font-[900] text-ink text-h2 leading-[1.15] tracking-[-0.01em] text-balance"
        >
          Built for the moment Stellar made it possible.
        </h2>

        <div className="mt-12 space-y-8 max-w-[60ch]">
          <p className="font-sans font-[400] text-ink text-lead leading-[1.6] text-wrap-pretty">
            Stellar's Protocol 25 and 26 put cryptographic primitives on-chain. The proof
            that a payroll batch adds up, without revealing a single amount, is checked by a
            Soroban contract on the ledger itself.
          </p>

          <p className="font-sans font-[400] text-ink-muted text-lead leading-[1.6] text-wrap-pretty">
            USDC is native through Circle's Stellar Asset Contract. Payroll settles in the
            token treasuries already hold, with the same finality, no bridge and no wrapped
            asset.
          </p>
        </div>
      </div>
    </section>
  )
}
