export interface DemoRow {
  /** The recipient's Stellar ACCOUNT address (G…) — what a normal salary tx exposes
   *  publicly on-chain TODAY. Used by the "without Sobrecito" (exposed) column. */
  address: string
  /** Employee identity in Sobrecito: a truncated X25519 pubkey, not a human name.
   *  Names are employer-local aliases and never touch the ledger, so the auditor
   *  reconstructs amounts keyed by pubkey (faithful to the real flow). */
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
    address: 'GABC…X4F9',
    employee: 'kQIO…XZW0',
    amount: '2,850 USDC',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    address: 'GDM2…K7Q2',
    employee: 'p9aF…7Lm2',
    amount: '1,920 USDC',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    address: 'GZT4…P81C',
    employee: 'zT4c…Qd81',
    amount: '3,400 USDC',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    address: 'GRN8…V5HE',
    employee: 'rN8h…Kv5e',
    amount: '1,830 USDC',
    status: { public: 'committed', auditor: '✓ proven' },
  },
]

export const PREDICATE_TOTAL = '10,000 USDC'

export const PREDICATE_LABEL = 'sum(payments) = 10,000 USDC · verified on-chain'
