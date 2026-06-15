import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import { encryptNote, decryptNote } from "../src/crypto/ecies.js";
import {
  encodeDualBlob,
  decodeDualBlob,
  buildEncryptedOutputs,
  N_OUTS,
} from "../src/crypto/encoding.js";
import type { EncryptedBlob, NotePayload } from "../src/types.js";

function keypair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = x25519.utils.randomSecretKey();
  const pub = x25519.getPublicKey(priv);
  return { priv, pub };
}

const samplePayload: NotePayload = {
  amount: 123_456_789n,
  blinding: 0xdeadbeefcafebaben,
};

describe("ECIES X25519 dual view-key (PROOF-03)", () => {
  it("round-trips a note payload for the employee key", () => {
    const employee = keypair();

    const blob = encryptNote(employee.pub, samplePayload);
    const recovered = decryptNote(employee.priv, blob);

    expect(recovered.amount).toBe(samplePayload.amount);
    expect(recovered.blinding).toBe(samplePayload.blinding);
  });

  it("dual-encodes one amount for employee + auditor; auditor decrypts its half", () => {
    const employee = keypair();
    const auditor = keypair();

    const employeeCt = encryptNote(employee.pub, samplePayload);
    const auditorCt = encryptNote(auditor.pub, samplePayload);

    const blob = encodeDualBlob(employeeCt, auditorCt);
    const decoded = decodeDualBlob(blob);

    // Both ciphertexts survive the encode/decode round-trip without loss.
    expect(decoded.employeeCiphertext).toEqual(employeeCt);
    expect(decoded.auditorCiphertext).toEqual(auditorCt);

    // The auditor recovers the payload from its half of the dual blob.
    const recovered = decryptNote(auditor.priv, decoded.auditorCiphertext);
    expect(recovered.amount).toBe(samplePayload.amount);
    expect(recovered.blinding).toBe(samplePayload.blinding);
  });

  it("prevents the employee from decrypting the auditor ciphertext (key separation)", () => {
    const employee = keypair();
    const auditor = keypair();

    const employeeCt = encryptNote(employee.pub, samplePayload);
    const auditorCt = encryptNote(auditor.pub, samplePayload);
    const blob = encodeDualBlob(employeeCt, auditorCt);
    const decoded = decodeDualBlob(blob);

    // The employee's key must NOT open the auditor's ciphertext: GCM tag fails.
    expect(() => decryptNote(employee.priv, decoded.auditorCiphertext)).toThrow();
  });

  it("guards buildEncryptedOutputs against a count other than 8 blobs (Pitfall 2)", () => {
    const employee = keypair();
    const auditor = keypair();
    const oneBlob: EncryptedBlob = {
      employeeCiphertext: encryptNote(employee.pub, samplePayload),
      auditorCiphertext: encryptNote(auditor.pub, samplePayload),
    };

    // Wrong count (1 != 8) must throw.
    expect(() => buildEncryptedOutputs([oneBlob])).toThrow();

    // Exactly N_OUTS (8) blobs must succeed and produce 8 encoded blobs.
    const eightBlobs: EncryptedBlob[] = Array.from({ length: N_OUTS }, () => ({
      employeeCiphertext: encryptNote(employee.pub, samplePayload),
      auditorCiphertext: encryptNote(auditor.pub, samplePayload),
    }));
    const outputs = buildEncryptedOutputs(eightBlobs);
    expect(outputs).toHaveLength(N_OUTS);

    // Each encoded blob decodes back to two non-empty ciphertexts.
    for (const encoded of outputs) {
      const decoded = decodeDualBlob(encoded);
      expect(decoded.employeeCiphertext.length).toBeGreaterThan(0);
      expect(decoded.auditorCiphertext.length).toBeGreaterThan(0);
    }
  });
});
