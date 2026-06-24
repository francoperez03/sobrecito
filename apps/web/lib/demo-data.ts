export interface DemoRow {
  /** Employee identity AS IT EXISTS ON-CHAIN: a truncated X25519 pubkey, not a
   *  human name. Names are employer-local aliases and never touch the ledger, so
   *  the auditor reconstructs amounts keyed by pubkey (faithful to the real flow). */
  employee: string
  /** USDC amount (the chain's unit), sealed in public view, revealed to the auditor. */
  amount: string
  status: {
    public: 'committed'
    auditor: '✓ proven'
  }
}

export const DEMO_ROWS: DemoRow[] = [
  {
    employee: 'kQIO…XZW0',
    amount: '2,850 USDC',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    employee: 'p9aF…7Lm2',
    amount: '1,920 USDC',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    employee: 'zT4c…Qd81',
    amount: '3,400 USDC',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    employee: 'rN8h…Kv5e',
    amount: '1,830 USDC',
    status: { public: 'committed', auditor: '✓ proven' },
  },
]

export const PREDICATE_TOTAL = '10,000 USDC'

export const PREDICATE_LABEL = 'sum(payments) = 10,000 USDC · verified on-chain'
