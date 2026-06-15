import type { EncryptedBlob } from "../types.js";

/**
 * Dual-blob encode/decode for the pool's `encrypted_outputs[i]` field.
 *
 * The pool stores one opaque `Bytes` blob per output note and emits it verbatim
 * in `NewCommitmentEvent` (it never parses the contents). The dual-encryption
 * scheme (D-02) packs both the employee and auditor ciphertexts into that single
 * blob without changing the contract signature (RESEARCH Anti-Pattern).
 *
 * Blob layout:
 *   [4B employee_len BE][employee_ct][4B auditor_len BE][auditor_ct]
 */

/** Number of output notes per payroll batch (nOuts of policy_tx_1_8). */
export const N_OUTS = 8;

const LEN_PREFIX_BYTES = 4;

/** Encode the two ciphertexts of one note into a single dual blob. */
export function encodeDualBlob(
  employeeCt: Uint8Array,
  auditorCt: Uint8Array,
): Uint8Array {
  const blob = new Uint8Array(
    LEN_PREFIX_BYTES + employeeCt.length + LEN_PREFIX_BYTES + auditorCt.length,
  );
  let offset = 0;
  offset = writeUint32BE(blob, offset, employeeCt.length);
  blob.set(employeeCt, offset);
  offset += employeeCt.length;
  offset = writeUint32BE(blob, offset, auditorCt.length);
  blob.set(auditorCt, offset);
  return blob;
}

/** Decode a dual blob back into its employee and auditor ciphertexts. */
export function decodeDualBlob(blob: Uint8Array): EncryptedBlob {
  let offset = 0;

  const employeeLen = readUint32BE(blob, offset);
  offset += LEN_PREFIX_BYTES;
  if (offset + employeeLen > blob.length) {
    throw new Error(
      `viewkey: malformed dual blob, employee ciphertext length ${employeeLen} overruns blob`,
    );
  }
  const employeeCiphertext = blob.slice(offset, offset + employeeLen);
  offset += employeeLen;

  const auditorLen = readUint32BE(blob, offset);
  offset += LEN_PREFIX_BYTES;
  if (offset + auditorLen !== blob.length) {
    throw new Error(
      `viewkey: malformed dual blob, auditor ciphertext length ${auditorLen} does not match remaining bytes`,
    );
  }
  const auditorCiphertext = blob.slice(offset, offset + auditorLen);

  return { employeeCiphertext, auditorCiphertext };
}

/**
 * Build the full array of encoded blobs for one payroll batch.
 *
 * Asserts there are exactly `N_OUTS` (8) blobs before returning. The pool does
 * NOT validate `encrypted_outputs.len() == output_commitments.len()`; if the
 * array is short, the pool silently emits empty blobs and the auditor loses notes
 * without any error (RESEARCH Pitfall 2). This guard is the last line of defense.
 */
export function buildEncryptedOutputs(blobs: EncryptedBlob[]): Uint8Array[] {
  if (blobs.length !== N_OUTS) {
    throw new Error(
      `viewkey: buildEncryptedOutputs expects exactly ${N_OUTS} blobs, got ${blobs.length}`,
    );
  }
  return blobs.map((blob) =>
    encodeDualBlob(blob.employeeCiphertext, blob.auditorCiphertext),
  );
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): number {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
  return offset + LEN_PREFIX_BYTES;
}

function readUint32BE(buf: Uint8Array, offset: number): number {
  if (offset + LEN_PREFIX_BYTES > buf.length) {
    throw new Error("viewkey: malformed dual blob, missing length prefix");
  }
  return (
    (buf[offset] << 24) |
    (buf[offset + 1] << 16) |
    (buf[offset + 2] << 8) |
    buf[offset + 3]
  );
}
