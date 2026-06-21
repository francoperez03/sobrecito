# Public Inputs Layout — UltraHonk, bb 0.87.0

**Fecha de medición:** 2026-06-21
**Circuito:** `circuits/sobre_slim` (slim, D2, 12 public inputs, nIns=1 nOuts=8, levels=10)
**Toolchain:** nargo 1.0.0-beta.9, bb 0.87.0, `--scheme ultra_honk --oracle_hash keccak --output_format bytes_and_fields`
**Validado contra:** verifier slim `CCIMHTM466A2V36MP3JJOV22C6CPPG3OBXM634Q77OAMBYDZJORRCFPO` en testnet Stellar
**Script de validación:** `scripts/verify_public_inputs_layout.ts` (NOIR-05)

---

## Corrección vs. el plan asumido

El plan 09-03 y la investigación RESEARCH.md §6 asumían 28 fields / 896 bytes
(12 inputs del circuito + 16 elements del Pairing-Point Object). Eso corresponde
al formato interno de Aztec para UltraHonk cuando el PPO se serializa por separado.

**La realidad con bb 0.87.0:**

| Artefacto | Plan asumido | Realidad medida |
|-----------|-------------|-----------------|
| `public_inputs` | 28 fields / 896 bytes | **12 fields / 384 bytes** |
| PPO (16 elements) | al final de `public_inputs` | **embebido en `proof`** |
| `proof` | 14 592 bytes | 14 592 bytes (sin cambio) |

bb 0.87.0 con `--output_format bytes_and_fields` DOBLA (folds) el Pairing-Point
Object dentro del blob `proof`. El archivo `public_inputs` que emite bb contiene
exclusivamente los 12 public inputs declarados en el circuito. No hay PPO separado
que agregar ni reordenar.

El blob de bb es directamente drop-in para `verify_proof`.

---

## Layout real de `public_inputs`

- **Tamaño total:** 384 bytes
- **Cantidad de fields:** 12
- **Bytes por field:** 32
- **Endianness:** big-endian (representación U256)
- **Fuente:** `circuits/sobre_slim/target/public_inputs` (generado por bb)

### Tabla de fields (del spike 09-02, witness con in_amount=10, un output de 10)

| Index | Signal              | Primeros 8 bytes (hex) | Valor completo (hex, 32 bytes)                                   |
|-------|---------------------|------------------------|------------------------------------------------------------------|
| 0     | root                | `05fc81f99bb9968c`     | `05fc81f99bb9968cf4b3e4818be85a3e745dd516b9585a66f9334cfa744c0ecb` |
| 1     | public_amount       | `0000000000000000`     | `0000000000000000000000000000000000000000000000000000000000000000` |
| 2     | ext_data_hash       | `0000000000000000`     | `00000000000000000000000000000000000000000000000000000000075bcd15` |
| 3     | input_nullifier     | `2d73af9d62901c0a`     | `2d73af9d62901c0adf7a5415e0182ffe90dc7a811526152b30d68a9a96b4c045` |
| 4     | output_commitment_0 | `1e66ae1bab91e2c1`     | `1e66ae1bab91e2c1b37dcd9cf1697372647045f508cc7fe4c3525f6d6e5f769f` |
| 5     | output_commitment_1 | `09bed8eb50d93ee6`     | `09bed8eb50d93ee63e4d57f090c2f34ad04a90dbd76dc53aa26c24b71b1dd0d1` |
| 6     | output_commitment_2 | `0a9e46d974a81257`     | `0a9e46d974a812578c0e3877ea16701226a20e7464c6e903dc9fe50198b1e8d7` |
| 7     | output_commitment_3 | `0d581b0a2b8a9f3e`     | `0d581b0a2b8a9f3e0efb06842b1da0208b46dd28c5dd97d51e36ac814c13f594` |
| 8     | output_commitment_4 | `17edbe787d846919`     | `17edbe787d846919e462758a668f81ea603bba28997545b81f1060fb531eb600` |
| 9     | output_commitment_5 | `087af7a2f9f827fb`     | `087af7a2f9f827fbbe724253c7d2381d5bba3516ef44bd62015cd310ed3830c7` |
| 10    | output_commitment_6 | `19242aee185e6caf`     | `19242aee185e6caf9cc035fbd5eda3ef271a16af78b800c4b226694d21666937` |
| 11    | output_commitment_7 | `12e37bfe8fdd5bb4`     | `12e37bfe8fdd5bb492ba65a859a41ea4463f97c11c70afa6c1d51080b905bfb4` |

**Nota sobre output_commitment_1..7:** El circuito slim tiene 8 outputs, pero el
witness de prueba usa solo el primero para un pago de 10 USDC shielded. Los outputs
1 a 7 contienen el empty-leaf commitment (ZERO_LEAF = Poseidon2("XLM")), que en
la representación field no es cero. Esto es comportamiento correcto.

---

## Ubicación del PPO (Pairing-Point Object)

El PPO (16 elementos `Fr`, uno por cada verificación de pairing) va embebido en
los **últimos 512 bytes** de `proof` (14 592 bytes totales). El offset exacto
depende de la serialización interna de bb 0.87.0. Lo que importa para el pool:
**el PPO NUNCA aparece en `public_inputs`**.

Prueba on-chain (verificada por `verify_public_inputs_layout.ts`):
- Blob completo de 384 bytes (12 fields) → `verify_proof` retorna OK
- Blob truncado de 352 bytes (11 fields) → `verify_proof` retorna error (blob rechazado)
- Esto confirma que los 12 fields son load-bearing y que no se necesita agregar PPO

---

## Instrucción drop-in para 09-04 (pool swap)

El pool (contrato Soroban, 09-04) debe pasar el blob de `public_inputs` de bb
**directamente** a `verify_proof`. No reconstruir field-por-field como hacía el
verifier Groth16 viejo.

**Patrón correcto (lado cliente/orchestrator):**

```typescript
// Cargar los artefactos producidos por bb
const publicInputsBytes = fs.readFileSync('circuits/sobre_slim/target/public_inputs');
const proofBytes        = fs.readFileSync('circuits/sobre_slim/target/proof');

// Pasar ambos buffers directamente a verify_proof
// publicInputsBytes.length === 384 (12 × 32)
// proofBytes.length         === 14592
await contract.call('verify_proof',
  nativeToScVal(publicInputsBytes, { type: 'bytes' }),
  nativeToScVal(proofBytes,        { type: 'bytes' })
);
```

**Patrón correcto (Soroban/Rust, lado pool):**

```rust
// El pool recibe public_inputs: Bytes y proof_bytes: Bytes del llamador.
// No interpretar ni reordenar los bytes; pasarlos al verifier tal cual.
verifier_contract.verify_proof(&env, public_inputs, proof_bytes)?;
```

**Lo que NO se debe hacer (patrón Groth16 viejo — INCORRECTO para UltraHonk):**

```rust
// INCORRECTO para UltraHonk bb 0.87.0
let mut pi_vec: Vec<Bn254Fr> = vec![];
pi_vec.push(Bn254Fr::from(root));
pi_vec.push(Bn254Fr::from(public_amount));
// ... etc.
// El PPO nunca está en public_inputs; reconstruirlo desde cero no aplica.
```

---

## Resumen de la validación NOIR-05

| Check | Resultado |
|-------|-----------|
| `public_inputs.length === 384` | PASS |
| `proof.length === 14592` | PASS |
| Caso positivo: blob completo → verify_proof OK | PASS |
| Caso negativo: blob truncado (11 fields) → verify_proof FAIL | PASS |
| Todos los 12 fields documentados con hex real | DONE |

**NOIR-05 status: GREEN.** El layout de public inputs está validado contra el
verifier on-chain. Wave 4 (09-04, pool swap) puede arrancar con la instrucción
drop-in de esta página.
