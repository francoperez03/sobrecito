import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { reconstructBatch } from "../src/reconstructor/batchReconstructor.js";
import { encryptNote } from "../src/crypto/ecies.js";
import { encodeDualBlob, N_OUTS } from "../src/crypto/encoding.js";
import { buildExtContextHash } from "../src/types.js";
import type { ScannedEvent } from "../src/scanner/eventScanner.js";
import type { NotePayload } from "../src/types.js";

function keypair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = x25519.utils.randomSecretKey();
  const pub = x25519.getPublicKey(priv);
  return { priv, pub };
}

/** Per-note amounts for a fixture payroll batch. They sum to T = 800. */
const AMOUNTS = [50n, 80n, 120n, 60n, 200n, 90n, 110n, 90n];
const T = 800n;

const POOL_ADDRESS = "CDHJ6W5ZCK7STNED7AT7SKCURQDFVCFJL6ZBF6XW7QMPOIBKHAOLCVL2";
const PERIOD_START = 1_700_000_000;

/**
 * Build a fixture batch of 8 dual blobs (employee + auditor ciphertexts) with the
 * given auditor pubkey, mirroring what the pool would emit in `NewCommitmentEvent`.
 */
function buildFixtureEvents(auditorPub: Uint8Array): ScannedEvent[] {
  const employee = keypair();
  return AMOUNTS.map((amount, index) => {
    const payload: NotePayload = { amount, blinding: BigInt(1000 + index) };
    const employeeCt = encryptNote(employee.pub, payload);
    const auditorCt = encryptNote(auditorPub, payload);
    const encryptedOutput = encodeDualBlob(employeeCt, auditorCt);
    return {
      commitment: BigInt(0xc0ffee00 + index),
      index,
      encryptedOutput,
      ledger: 3_107_100 + index,
      txHash: `deadbeef${index.toString().padStart(56, "0")}`,
    };
  });
}

describe("batch reconstructor (PROOF-04)", () => {
  it("reconstructs the per-note desglose and reconciles against T from fixtures", async () => {
    const auditor = keypair();
    const events = buildFixtureEvents(auditor.pub);
    expect(events).toHaveLength(N_OUTS);

    const summary = await reconstructBatch({
      auditorPrivkey: auditor.priv,
      source: { events },
      poolAddress: POOL_ADDRESS,
      periodStart: PERIOD_START,
    });

    // 8 notes recovered, total reconciles against T.
    expect(summary.notes).toHaveLength(8);
    expect(summary.total).toBe(T);

    // Per-note amounts match the original payroll.
    const recovered = summary.notes
      .sort((a, b) => a.index - b.index)
      .map((n) => n.amount);
    expect(recovered).toEqual(AMOUNTS);

    // The desglose reduces exactly to the declared total (sum === T).
    const reduced = summary.notes.reduce((acc, n) => acc + n.amount, 0n);
    expect(reduced).toBe(summary.total);

    // Period binding: extContextHash matches the canonical builder.
    expect(summary.extContextHash).toBe(
      buildExtContextHash(POOL_ADDRESS, PERIOD_START),
    );
    expect(summary.poolAddress).toBe(POOL_ADDRESS);
    expect(summary.periodStart).toBe(PERIOD_START);
  });

  it("records commitment and index from each scanned event", async () => {
    const auditor = keypair();
    const events = buildFixtureEvents(auditor.pub);

    const summary = await reconstructBatch({
      auditorPrivkey: auditor.priv,
      source: { events },
      poolAddress: POOL_ADDRESS,
      periodStart: PERIOD_START,
    });

    for (const note of summary.notes) {
      const source = events.find((e) => e.index === note.index);
      expect(source).toBeDefined();
      expect(note.commitment).toBe(source!.commitment);
    }
  });

  it("reveals nothing with the wrong auditor key (key separation)", async () => {
    const auditor = keypair();
    const intruder = keypair();
    const events = buildFixtureEvents(auditor.pub);

    // The intruder cannot open the auditor ciphertexts (GCM tag fails), so every
    // blob is skipped: the reconstruction yields no notes and a zero total. This
    // is the selective-disclosure contract under a multi-batch pool — a foreign
    // key reveals nothing rather than aborting the whole scan.
    const summary = await reconstructBatch({
      auditorPrivkey: intruder.priv,
      source: { events },
      poolAddress: POOL_ADDRESS,
      periodStart: PERIOD_START,
    });
    expect(summary.notes).toHaveLength(0);
    expect(summary.total).toBe(0n);
  });

  it("carries ledger and txHash from each scanned event into the note (AUD-01)", async () => {
    const auditor = keypair();
    const events = buildFixtureEvents(auditor.pub);
    const summary = await reconstructBatch({
      auditorPrivkey: auditor.priv,
      source: { events },
      poolAddress: POOL_ADDRESS,
      periodStart: PERIOD_START,
    });
    for (const note of summary.notes) {
      const source = events.find((e) => e.index === note.index)!;
      expect(note.ledger).toBe(source.ledger);
      expect(note.txHash).toBe(source.txHash);
    }
  });
});
