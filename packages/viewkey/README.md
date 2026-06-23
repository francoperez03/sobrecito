# viewkey

The view-key core of Sobrecito: the package that encrypts each payroll note to
its recipients and lets the auditor reopen the per-employee detail of a batch.

## What it is

Every output note in a batch carries a **dual ECIES blob**: the amount + blinding
are encrypted twice, once to the employee's X25519 key and once to the auditor's
X25519 view-key. The public sees only ciphertext; the employee opens their own
note, and the auditor reconstructs the whole batch and reconciles it against the
proven total `T`.

The scheme is ECIES over **X25519 + HKDF-SHA256 + AES-256-GCM**, built entirely on
`@noble` primitives (no hand-rolled crypto). Blob layout:
`ephemeralPub(32) || iv(12) || ciphertext+tag`. Notes are encrypted to the
recipient's X25519 `encryption_key` (the pool `Account.encryption_key`), never to
the BN254 `note_key` used for circuit commitments.

## Public API

```ts
import {
  encryptNote, decryptNote,            // ECIES single-note encrypt/decrypt
  encodeDualBlob, decodeDualBlob,      // employee||auditor dual blob
  buildEncryptedOutputs, N_OUTS,       // the 8 encrypted_outputs of a batch
  scanCommitmentEvents,                // read NewCommitmentEvent from the pool
  scanSpentNullifiers,                 // read NewNullifierEvent (claim status)
  reconstructBatch,                    // auditor: scan → decrypt → reconcile vs T
  generateAuditorKeypair,              // user-facing X25519 keygen
  keyToBase64, keyFromBase64,
} from 'viewkey'
```

`reconstructBatch` is the auditor path; `decryptNote` + the scanner power the
employee scan and claim. `scanSpentNullifiers` drives the per-note claim status.

## Build / test

```bash
pnpm --filter viewkey build   # tsc → dist/ (output is gitignored)
pnpm --filter viewkey test    # vitest
```

> `dist/` is uncommitted. After a fresh checkout (or pull) run the build before
> the web app, so the auditor and employee flows resolve `viewkey`.

## Guarantee

Confidentiality of individual amounts against the public (A1) and scoped
disclosure to the auditor (A2). The auditor's view-key is the only thing that
reopens the detail; losing it means the batch stays sealed. **PoC, not audited,
testnet.**
