# Phase 09 spike-gate — resultados (NOIR-01 + NOIR-02)

**Fecha:** 2026-06-21
**Circuito:** `circuits/sobre_slim` (slim, D2: sin ASP/SMT, 12 public inputs, 1 input / 8 outputs, levels=10).
**Toolchain (D4):** nargo 1.0.0-beta.9, bb 0.87.0, @aztec/bb.js 0.87.0, scheme `ultra_honk`, oracle `keccak`, `--output_format bytes_and_fields`.

## VEREDICTO: GREEN

Ambos números propios entran cómodos. Wave 3+ (09-03..09-06) puede arrancar por el camino UltraHonk nativo. No se dispara Plan B (Noir->Groth16) ni el fallback de proofs pre-generadas.

---

## Task 0 — Alineación Poseidon2 (Option B): MATCH

`cross_check_poseidon.ts` contra el contrato on-chain `poseidon2-tester`
(`CCX7PHZ2DKN36JIMLOFDI5M7G72X3NFNPRNMM25O663H5AXAFDK26SLG`, testnet, cuenta `spike`)
imprime **MATCH** y sale 0.

| Hash | Noir (poseidon2_pool) | Soroban on-chain | Match |
|------|-----------------------|------------------|-------|
| `compress(1,2)` (Merkle, t=2) | `6588139247…922547` | `6588139247…922547` | MATCH |
| `hash2(100,7,sep=1)` (t=3)    | `9730367341…027568` | `9730367341…027568` | MATCH |

Verificación adicional contra la referencia canónica `zkhash` (la misma fuente de
constantes que el Circom witness-gen que produjo los commitments existentes):

| Hash | Noir | zkhash ref | Match |
|------|------|-----------|-------|
| `commitment([100,7,42,1])` (t=4) | `20060111…326850` | `20060111…326850` | MATCH |
| `keypair([5,0,3])` (t=3)         | `19323068…870808` | `19323068…870808` | MATCH |

**Decisión Option B aplicada:** el pool y `soroban-utils` quedan SIN CAMBIOS (la cadena
on-chain es la fuente de verdad). El circuito Noir reproduce la Poseidon2 del pool
byte-por-byte (`src/poseidon2_pool.nr` + `src/poseidon2_constants.nr`).

### Reconciliación de aridad (commitment vs Merkle compress)

- **Hash ON-CHAIN load-bearing:** la **compresión Merkle es t=2** (`poseidon2_compress`:
  `perm_t2([l,r])[0] + l`). El circuito reconstruye el root con esta compresión y lo
  asierta contra el root on-chain del pool, así que DEBE matchear el pool exactamente. ✓
- **Commitment / nullifier / signature:** el Circom usa `Poseidon2(3)` =
  `Permutation(4)` con state `[a,b,c,domSep]` y toma `out[0]` (una permutación **t=4**,
  computada OFF-CHAIN por el witness-gen / auditor / empleado). El pool NO expone t=4;
  estos hashes nunca corren on-chain, solo entran al circuito como public inputs / hojas.
  El circuito los recomputa con el mismo t=4 del Circom (constantes de
  `poseidon2_const.circom`), así los flujos off-chain (reconstrucción del auditor por
  suma, claim del empleado) quedan consistentes.
- **Keypair:** `Poseidon2(2)` = `Permutation(3)` con `[priv,0,domSep]`, t=3 (igual que el
  pool `hash2`).
- El `<interfaces>` del plan describía el commitment como `Poseidon2::hash([...],4)`; la
  fuente real (`policyTransaction.circom` + `poseidon2_hash.circom`) confirma
  `Poseidon2(3)`=`Permutation(4)` con domSep en la capacidad. Se siguió la fuente.

**Nota de implementación:** ni `noir-lang/poseidon` v0.2.0 ni
`std::hash::poseidon2_permutation` reproducen el pool (ambos son un sponge t=4 con
IV = message_size·2^64; además el stdlib solo soporta t=4). Por eso se portaron las
permutaciones t=2/t=3/t=4 directamente en el circuito. Las matrices internas t=2/t=3 que
usa el SDK están hardcodeadas (`[[2,1],[1,3]]` y `[[2,1,1],[1,2,1],[1,1,3]]`) e ignoran
el `mat_diag` que el pool pasa para esos anchos.

---

## Task 1 — Circuito slim completo: nargo execute OK

- 12 public inputs separados (`root, public_amount, ext_data_hash, input_nullifier,
  output_commitment_0..7`), patrón many_pubs.
- keypair (t=3), commitment/signature/nullifier (t=4), 8 output commitments (t=4),
  reconstrucción Merkle depth-10 con compress (t=2), range check 248-bit por output,
  invariante de conservación `in_amount + public_amount == sum(out_amount)`.
- D2: sin ASP membership ni SMT non-membership (drop disclosed).
- `nargo execute` pasa con un witness válido derivado (in_amount=10, un output de 10);
  genera `target/sobre_slim.gz`. Test negativo: romper la conservación / el commitment
  hace fallar la constraint.

---

## Task 2 PARTE A — NOIR-01: verify on-chain del shape slim

**Medición real (no simulada en vacío, submit confirmado en testnet).**

| Métrica | Valor |
|---------|-------|
| **cpuInsns (verify_proof)** | **87,016,129** |
| Criterio (CONTEXT.md) | < 400,000,000 |
| **Resultado** | **PASS** (21.75% del techo de 400M) |
| Min resource fee | 143,873 stroops (0.0143873 XLM) |
| Proof size | 14,592 bytes |
| Public inputs size | 384 bytes (12 fields × 32) |
| Tx envelope | 15,340 bytes |

**Submit on-chain confirmado:** tx `3f30e00ff60cf189fda4e72bff909707df19bd645979ed5203264b052a0ee804`,
ledger 3,211,979, fee 129,110 stroops, sin FAILED → el proof slim **verifica on-chain**.

**Artefactos:**
- Verifier slim deployado: `CCIMHTM466A2V36MP3JJOV22C6CPPG3OBXM634Q77OAMBYDZJORRCFPO`
  (UltraHonk nativo `rs-soroban-ultrahonk`, `__constructor(vk_bytes)` con la VK del slim).
  Deploy tx `f300252ef48989052985fd2ebbbf6577a9990f3ebd4468cdea5acfd2459716ce`.
- VK / proof generados con bb 0.87.0 y los flags D4 (ver `target/bb_command.log`):
  `--scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields`.
- `bb verify` local: exit 0 (proof verified successfully).

---

## Task 2 PARTE B — NOIR-02: proving bb.js en Node

`scripts/spike_browser_prove.ts` (UltraHonkBackend de `@aztec/bb.js@0.87.0`, oracle keccak)
ejecuta el circuito, genera y verifica el proof del slim.

| Métrica | Valor |
|---------|-------|
| **Tiempo de proving (bb.js)** | **1.741 s** |
| Tiempo de witness (noir_js) | 0.125 s |
| Tiempo de verify (bb.js) | 0.512 s |
| proof.length | 14,592 bytes |
| publicInputs.length | 12 fields |
| verifyProof | **true** |

**Sobre `publicInputs.length`:** el plan esperaba 28 (12 + 16 pairing-point-object). En
bb 0.87.0 el PPO va embebido en el proof (proof.length = 14,592 igual al esperado) y
`publicInputs` expone solo los 12 public inputs reales del circuito. No es un fallo;
es la forma de la API en esta versión pineada. El layout exacto de public inputs para el
pool se fija en Wave 3 (09-03).

**Pacing del demo:** 1.74 s de proving entra holgado en el pacing del video. No se
dispara el fallback de proofs pre-generadas.

---

## Disclosure honesto

- PoC sobre **testnet**, tope real **1 USDC** (las notas son field data, no transferencias).
- **Sin auditar.** Trusted setup no aplica a UltraHonk (transparente), pero el circuito,
  la VK y el verifier no pasaron auditoría externa.
- D2: se elimina la soundness de política (allowlist / non-inclusión ASP). No es
  load-bearing para el predicado de payroll (`sum=T` con montos shielded + view-key).
  Se documenta y se cierra el disclosure en 09-06.
- Los números (cpuInsns y tiempo de proving) son **propios y reproducibles**, medidos
  contra el shape real de Sobre, no heredados de otro circuito.
