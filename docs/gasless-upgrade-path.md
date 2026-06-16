# Gasless upgrade path — OZ Relayer + passkey (employee claim)

> **PoC disclosure.** This document is part of the honest-disclosure contract. The
> shipped employee-claim surface (`/employee/[token]`) uses the **Freighter**
> fallback: the employee signs the unshield with their own wallet and pays their own
> XLM fee. The fully gasless flow (OZ Relayer + passkey smart account) was **NOT**
> deliverable inside the hackathon window and is **NOT silently dropped** — it is
> documented here as the upgrade path, with the exact unmet dependencies and the
> steps to close them.

## Why Freighter ships now (RESEARCH D-12 verdict)

Per the RESEARCH **D-12 Gasless Relayer: Go / Fallback Verdict** and its feasibility
table, the full-gasless path has two **unmet external dependencies** and **zero
end-to-end coverage**:

| Capability | Status (RESEARCH D-12) |
|------------|------------------------|
| OZ Relayer Channels plugin importable | CONFIRMED (Phase 3 spike, `@openzeppelin/relayer-plugin-channels` v0.20.0) |
| Hosted testnet API key (`https://channels.openzeppelin.com/testnet`) | **NOT OBTAINED** — endpoint alive but returns HTTP 401; key never requested |
| `passkey-kit` factory contract on testnet | **EXTERNAL** — not in the `sobrecito-view-key` deployments |
| End-to-end gasless flow | **NEVER TESTED**; no cost data |

The RESEARCH fallback ladder (implement top-down, stop when it works) puts Freighter
**first**:

1. **Freighter (no relayer) — DEFAULT, shipped.** The link carries the note metadata
   (commitment index, X25519 note privkey, blinding). The employee clicks
   *Claim salary*; Freighter signs a standard `pool.transact` (withdraw); the
   employee pays their own XLM fee. No new infra. Preserves **A1** (unlinkability):
   the employee chooses when and to which fresh address to claim, so an observer
   cannot re-link the on-chain withdraw to the employer's payroll batch.
2. Employer push — loses A1; declared honestly if ever used.
3. **Full gasless (OZ Relayer + passkey)** — only if the hosted API key **and** the
   passkey factory **and** the note-key delivery design were all obtained within the
   first 24 hours of execution. They were not.

Shipping Freighter delivers the visible employee-claim surface (the amber warning
chip + *Claim salary* CTA intact, A1 preserved) with **zero external dependencies**,
without blocking UX-01/02/03.

## What the full-gasless flow requires

The gasless vision (D-12 exact): the employee never holds XLM. Their browser signs a
Soroban auth entry with a **passkey smart wallet**, and the **OZ Relayer** submits
the transaction and pays the fee.

### Component A — OZ Relayer

The relayer submits the employee's signed auth entry and fee-bumps it. Two ways to
run it:

- **Hosted testnet endpoint** (`https://channels.openzeppelin.com/testnet`):
  requires an **API key** from OpenZeppelin (one-time async registration at
  `relayer.openzeppelin.com`). The Phase 3 spike confirmed the endpoint is live
  (HTTP 401, alive but gated). With the key, this path needs zero infra setup.
- **Self-hosted** the OZ Relayer instance with the Channels plugin — more infra
  overhead than a hackathon window justifies.

### Component B — passkey smart wallet (`passkey-kit`)

`passkey-kit@0.12.0` wraps a Stellar smart-wallet contract deployed at a **factory
address on testnet**. Flow: the employee registers a passkey credential (WebAuthn,
secp256r1) → the factory deploys a smart wallet bound to that credential → the wallet
signs Soroban auth entries → the OZ Relayer submits and fee-bumps. Critical
dependency: the **factory contract must already be deployed on testnet**, and its
address is **not** in the `sobrecito-view-key` deployments. Its testnet availability
and TTL maintenance are external.

### Component C — note-key delivery design

The note key still has to reach the employee. In the Freighter path it lives in the
claim link. For the gasless path the note key must be combined with passkey
credential registration so the employee both proves possession of the note and signs
the unshield through their smart wallet, without leaking the note key to the relayer
(the relayer must remain outside the trust base — A4: it submits, it never holds the
note key).

## Exact steps to upgrade Freighter → gasless

1. **Obtain the hosted testnet API key.** Register at `relayer.openzeppelin.com`,
   request the Channels testnet key, confirm `https://channels.openzeppelin.com/testnet`
   returns 200 (not 401) with the key in the auth header.
2. **Stand up the passkey factory on testnet.** Deploy (or locate a live)
   `passkey-kit` smart-wallet factory; record its address in
   `ops/deployments/testnet/deployments.json` alongside the pool.
3. **Add the SDKs.** `passkey-kit@0.12.0` (passkey credential creation + signing,
   wraps `@simplewebauthn/browser`) and `@openzeppelin/relayer-plugin-channels`
   (`ChannelsClient.submitSorobanTransaction`).
4. **Swap the signer in `apps/web/lib/employee-unshield.ts`.** Replace the Freighter
   `signTransaction` call with: build the `pool.transact` (withdraw) op → produce the
   `SorobanAuthorizationEntry` → sign it with the passkey smart wallet (`passkey-kit`)
   → hand the base64 auth XDR to `ChannelsClient.submitSorobanTransaction({ ... auth: [...] })`.
   The relayer submits and fee-bumps; the employee pays **no** XLM.
5. **Update the UI.** Replace the wallet confirmation with the browser-native passkey
   prompt; keep the amber warning chip and the *Claim salary* CTA copy unchanged.
6. **Cover it end-to-end.** Add a testnet integration test for the passkey + relayer
   path (cost + latency were never measured in the spike — measure them here).

Until all six are done, the **Freighter** path remains the default. This is a
**v1 policy/infra limit**, declared honestly, not a hidden gap.

---

*Source: RESEARCH `06-RESEARCH.md` — §D-12 Gasless Relayer: Go / Fallback Verdict,*
*feasibility table, and the dependency matrix. PoC — not audited.*
