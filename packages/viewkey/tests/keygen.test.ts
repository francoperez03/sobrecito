import { describe, it, expect } from "vitest";
import { x25519 } from "@noble/curves/ed25519.js";
import {
  generateAuditorKeypair,
  keyToBase64,
  keyFromBase64,
} from "../src/crypto/keygen.js";

describe("auditor keygen (AUD-03)", () => {
  it("generates a 32-byte X25519 keypair", () => {
    const kp = generateAuditorKeypair();
    expect(kp.privkey instanceof Uint8Array).toBe(true);
    expect(kp.privkey.length).toBe(32);
    expect(kp.pubkey instanceof Uint8Array).toBe(true);
    expect(kp.pubkey.length).toBe(32);
  });

  it("derives a pubkey that matches x25519.getPublicKey", () => {
    const kp = generateAuditorKeypair();
    expect(keyToBase64(kp.pubkey)).toBe(
      keyToBase64(x25519.getPublicKey(kp.privkey)),
    );
  });

  it("roundtrips a 32-byte key through base64", () => {
    const kp = generateAuditorKeypair();
    const recovered = keyFromBase64(keyToBase64(kp.pubkey));
    expect(Array.from(recovered)).toEqual(Array.from(kp.pubkey));
  });

  it("rejects a base64 string that does not decode to 32 bytes", () => {
    expect(() => keyFromBase64(keyToBase64(new Uint8Array(16)))).toThrow(
      /32 bytes/,
    );
  });

  it("produces distinct keypairs across calls", () => {
    const a = generateAuditorKeypair();
    const b = generateAuditorKeypair();
    expect(keyToBase64(a.privkey)).not.toBe(keyToBase64(b.privkey));
  });
});
