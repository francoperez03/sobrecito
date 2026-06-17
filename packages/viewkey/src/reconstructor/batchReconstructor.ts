import { decodeDualBlob } from "../crypto/encoding.js";
import { decryptNote } from "../crypto/ecies.js";
import { buildExtContextHash } from "../types.js";
import type { AuditorNote, BatchSummary } from "../types.js";
import { scanCommitmentEvents } from "../scanner/eventScanner.js";
import type { ScannedEvent } from "../scanner/eventScanner.js";

/**
 * Auditor-side batch reconstruction (PROOF-04).
 *
 * The auditor takes the per-output encrypted blobs the pool emitted in
 * `NewCommitmentEvent`, decrypts its half of each dual blob (D-02), and rebuilds
 * the per-note desglose. The reconstructed amounts reconcile against the declared
 * total T (`summary.total === sum(amounts)`), so the auditor never trusts an
 * employer-supplied breakdown: it derives T from the ciphertext it can open.
 *
 * Event source is parameterized so the orchestrator runs either against the live
 * pool (`scanCommitmentEvents` over a ledger range) or against injected fixture
 * events (local tests, no testnet). The SelectiveDisclosure proof verification is
 * already covered at the circuit layer (Task 1, Rust); this orchestrator focuses on
 * decryption + reconciliation. Optional on-chain proof verification with snarkjs is
 * a deferred stretch (D-04), not wired here.
 */

/**
 * Source of the encrypted-output events to reconstruct.
 *
 * - `events`: inject a fixed `ScannedEvent[]` (local/test mode, no testnet).
 * - scan options: pull `NewCommitmentEvent`s from the live pool over a ledger range.
 */
export type EventSource =
  | { events: ScannedEvent[] }
  | {
      rpcUrl: string;
      poolContractId: string;
      fromLedger: number;
      toLedger?: number;
    };

export interface ReconstructOptions {
  /** Auditor X25519 private key (32 bytes). Opens the auditor half of each blob. */
  auditorPrivkey: Uint8Array;
  /** Where the events come from: injected fixtures or a live scan range. */
  source: EventSource;
  /** Pool address, bound into the period `extContextHash`. */
  poolAddress: string;
  /** Period start (unix seconds), bound into the period `extContextHash`. */
  periodStart: number;
  /**
   * Employee X25519 pubkeys per event index, when known (from `PublicKeyEvent`).
   * Recorded into each `AuditorNote` for downstream reconciliation; absent entries
   * default to an empty array.
   */
  employeePubkeys?: Map<number, Uint8Array>;
}

/** Resolve the event source into a concrete `ScannedEvent[]`. */
async function resolveEvents(source: EventSource): Promise<ScannedEvent[]> {
  if ("events" in source) {
    return source.events;
  }
  return scanCommitmentEvents({
    rpcUrl: source.rpcUrl,
    poolContractId: source.poolContractId,
    fromLedger: source.fromLedger,
    toLedger: source.toLedger,
  });
}

/**
 * Reconstruct one payroll batch from the auditor's point of view.
 *
 * Orchestration: resolve events → for each blob `decodeDualBlob` →
 * `decryptNote(auditorPrivkey, auditorCiphertext)` → assemble `AuditorNote` →
 * sum amounts into `total`. Returns a `BatchSummary` bound to the period
 * `extContextHash`.
 */
export async function reconstructBatch(
  opts: ReconstructOptions,
): Promise<BatchSummary> {
  const events = await resolveEvents(opts.source);

  const notes: AuditorNote[] = [];
  let total = 0n;

  for (const event of events) {
    // A pool can hold many batches, each encrypted to a different auditor key.
    // Decrypt only the outputs that belong to THIS view-key; skip the rest
    // (a foreign blob fails the ECIES auth tag and throws). This is the
    // selective-disclosure contract: an auditor reconstructs only their batch.
    let payload: ReturnType<typeof decryptNote>;
    try {
      const blob = decodeDualBlob(event.encryptedOutput);
      payload = decryptNote(opts.auditorPrivkey, blob.auditorCiphertext);
    } catch {
      continue;
    }

    const employeePubkeyX25519 =
      opts.employeePubkeys?.get(event.index) ?? new Uint8Array(0);

    notes.push({
      commitment: event.commitment,
      index: event.index,
      amount: payload.amount,
      blinding: payload.blinding,
      employeePubkeyX25519,
      ledger: event.ledger,
      txHash: event.txHash,
    });

    total += payload.amount;
  }

  const extContextHash = buildExtContextHash(opts.poolAddress, opts.periodStart);

  return {
    total,
    notes,
    extContextHash,
    periodStart: opts.periodStart,
    poolAddress: opts.poolAddress,
  };
}
