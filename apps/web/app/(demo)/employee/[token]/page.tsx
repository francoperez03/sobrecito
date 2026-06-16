'use client'

import { use } from 'react'
import { Reveal } from '@/components/motion/Reveal'
import { EmployeeClaimCard } from '@/components/employee/EmployeeClaimCard'
import type { NoteMeta } from '@/lib/employee-unshield'

/**
 * Employee claim route (`/employee/[token]`, UI-SPEC Surface 4, STRETCH).
 *
 * The per-employee claim link. The `[token]` param is a single opaque bearer
 * credential carrying the note metadata (commitment index, X25519 note privkey,
 * blinding) the employee needs to self-unshield (RESEARCH Open Question 2:
 * `sobre pay` generates an employee X25519 keypair per note and embeds it in the
 * link). The token is decoded entirely client-side — the note key never round-trips
 * to a server (T-06-18). A single-card page (no table): one action, claim.
 *
 * Default path is Freighter (RESEARCH D-12 fallback #1): the employee signs the
 * unshield with their own wallet and pays their own gas. The gasless (OZ Relayer +
 * passkey) upgrade is documented in docs/gasless-upgrade-path.md, not dropped.
 */
export default function EmployeeClaimPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const noteMeta = decodeToken(token)

  return (
    <main className="min-h-dvh">
      <section className="py-24 px-4 max-w-2xl mx-auto">
        {noteMeta ? (
          <Reveal delay={0}>
            <EmployeeClaimCard noteMeta={noteMeta} />
          </Reveal>
        ) : (
          <Reveal delay={0}>
            <div>
              <h2 className="text-h2 font-[900] tracking-[-0.01em] leading-[1.15]">
                This claim link is not valid.
              </h2>
              <p className="mt-3 text-lead text-ink-muted">
                Ask your employer to re-send the link from{' '}
                <span className="font-mono">sobre pay</span>.
              </p>
            </div>
          </Reveal>
        )}

      </section>
    </main>
  )
}

/**
 * Decode the claim token into note metadata. The token is a base64url-encoded JSON
 * of the `NoteMeta` (Claude's discretion per CONTEXT: a single opaque token that
 * carries the commitment index + X25519 note privkey + blinding). Decoding is
 * client-side only; a malformed token yields `null` (invalid-link state), never a
 * crash. The token is never logged and never sent to a server (T-06-18).
 */
function decodeToken(token: string): NoteMeta | null {
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded)
    const meta = JSON.parse(json) as Partial<NoteMeta>
    if (
      typeof meta.poolContractId === 'string' &&
      typeof meta.commitmentIndex === 'number' &&
      typeof meta.amount === 'string' &&
      typeof meta.notePrivkeyHex === 'string' &&
      typeof meta.blinding === 'string'
    ) {
      return meta as NoteMeta
    }
    return null
  } catch {
    return null
  }
}
