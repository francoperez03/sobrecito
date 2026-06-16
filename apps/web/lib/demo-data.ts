export interface DemoRow {
  employee: string
  amount: string
  status: {
    public: 'committed'
    auditor: '✓ proven'
  }
}

export const DEMO_ROWS: DemoRow[] = [
  {
    employee: 'Alice M.',
    amount: '$34,200',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    employee: 'Carlos R.',
    amount: '$28,750',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    employee: 'Priya S.',
    amount: '$41,100',
    status: { public: 'committed', auditor: '✓ proven' },
  },
  {
    employee: 'James T.',
    amount: '$38,450',
    status: { public: 'committed', auditor: '✓ proven' },
  },
]

export const PREDICATE_TOTAL = '$142,500'

export const PREDICATE_LABEL = 'sum(payments) = $142,500 · verified on-chain'

export interface NamedSalaryReceipt {
  accountHash: string
  amount: string
  timestamp: string
  source: string
}

export const NAMED_SALARY_RECEIPT: NamedSalaryReceipt = {
  accountHash: 'GABC…X4F9',
  amount: '$96,000',
  timestamp: '2024-03-15T14:22:07Z',
  source: 'Example on-chain transaction — public, permanent, and readable by anyone.',
}
