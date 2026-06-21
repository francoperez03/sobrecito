#!/usr/bin/env ts-node
/**
 * spike_browser_prove.ts — NOIR-02 spike-gate (D1).
 *
 * Proves the slim Sobre circuit with @aztec/bb.js UltraHonkBackend in Node,
 * simulating the in-browser prover. Produces and verifies the proof, and times
 * the proving step for the demo-pacing kill-switch.
 *
 * Pinned toolchain (D4): bb 0.87.0, nargo 1.0.0-beta.9, @aztec/bb.js@0.87.0.
 * The proof is generated with the keccak oracle so it matches the on-chain
 * UltraHonk verifier (the same --oracle_hash keccak used by the bb CLI).
 *
 * Usage:
 *   npx ts-node spike_browser_prove.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { Noir } from '@noir-lang/noir_js';
import { UltraHonkBackend } from '@aztec/bb.js';

const CIRCUIT_DIR = path.resolve(__dirname, '..', 'circuits', 'sobre_slim');
const CIRCUIT_JSON = path.join(CIRCUIT_DIR, 'target', 'sobre_slim.json');
const PROVER_TOML = path.join(CIRCUIT_DIR, 'Prover.toml');

// Minimal Prover.toml parser: handles `key = "value"` and `key = ["a", "b"]`.
function parseProverToml(toml: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (val.startsWith('[')) {
      const inner = val.slice(1, val.lastIndexOf(']'));
      out[key] = inner
        .split(',')
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter((s) => s.length > 0);
    } else {
      out[key] = val.replace(/^"|"$/g, '');
    }
  }
  return out;
}

async function main(): Promise<void> {
  console.log('=== NOIR-02 spike: bb.js UltraHonkBackend (Node) ===');

  const circuit = JSON.parse(fs.readFileSync(CIRCUIT_JSON, 'utf8'));
  const inputs = parseProverToml(fs.readFileSync(PROVER_TOML, 'utf8'));

  // 1. Execute the circuit to obtain the witness (the browser does this too).
  const noir = new Noir(circuit);
  console.time('witness');
  const { witness } = await noir.execute(inputs as never);
  console.timeEnd('witness');

  // 2. Generate the proof with bb.js. keccak oracle => on-chain-compatible proof.
  const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
  console.time('prove');
  const { proof, publicInputs } = await backend.generateProof(witness, {
    keccak: true,
  });
  console.timeEnd('prove');

  console.log(`proof.length         : ${proof.length} bytes`);
  console.log(`publicInputs.length  : ${publicInputs.length} fields`);

  // 3. Verify the proof in-process (same keccak oracle).
  console.time('verify');
  const ok = await backend.verifyProof({ proof, publicInputs }, { keccak: true });
  console.timeEnd('verify');
  console.log(`verifyProof          : ${ok ? 'true' : 'false'}`);

  await backend.destroy();

  if (!ok) {
    console.error('NOIR-02 FAIL: bb.js proof did not verify.');
    process.exit(1);
  }
  console.log('NOIR-02 OK: bb.js generated and verified the slim proof.');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
