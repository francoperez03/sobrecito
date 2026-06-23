# Migración a Noir: análisis de viabilidad (revisión post-spike)

**Fecha:** 2026-06-21
**Rama / worktree:** `spike/noir-migration-v2` · `Sobre/sobrecito-noir-migration`
**Circuito bajo análisis:** `sobrecito/packages/zk/circuits/src/policy_tx_1_8.circom`
(`PolicyTransaction(1, 8, 1, 1, 10, 10)`)
**Verifier actual:** `CircomGroth16Verifier` (Groth16/BN254, `env.crypto().bn254().pairing_check` nativo)

> Estado: COMPLETO (2026-06-21). §1-§2 certeros desde el código; §3 con fuentes
> primarias de junio 2026; §4 veredicto.

---

## 0. TL;DR

El proyecto **empezó en Noir + UltraHonk** (lock del 2026-06-13) y el spike de Phase 3
(2026-06-14) lo mató por una razón medible: el verify on-chain de UltraHonk excedía el
techo de 400M instrucciones de Soroban. Se re-pivoteó a Circom + Groth16, que hoy
verifica en ~104M (26% del techo) usando el precompile BN254 nativo.

**Veredicto (actualizado tras inspeccionar `rs-soroban-ultrahonk`): la migración a Noir
es VIABLE.** El bloqueo que mató el spike está resuelto. Con un track de Noir como razón
estratégica, vale la pena hacerla como **fase dedicada**. El riesgo ya no es el verifier
on-chain; es reescribir el circuito (§2) y la alineación Poseidon2.

**Qué cambió desde el spike (lo importante):** a nivel ecosistema poco en 7 días, pero el
spike estaba mal encuadrado y la evidencia hoy es contundente:

1. El bloqueo nunca fue UltraHonk como esquema: era el verifier `ark_bn254` puro. Con las
   host functions BN254 de Yardstick (P26, vivo en mainnet desde el 6-may-2026, **ya
   cierto el día del spike**) ese verifier baja de **557.8M → 112.5M** (disc. #1826).
2. **Y existe el artefacto, local, medido:** `Sobre/rs-soroban-ultrahonk` (Nethermind) es
   un verifier UltraHonk **100% nativo** (sin arkworks), con costo **medido ~81M en P26**
   (más barato que nuestro Groth16 de 104M), audit trail (`VERIFIER_PROVENANCE.md`), misma
   interfaz `verify_proof` que ya usamos, y harness de medición + pipeline testnet listos
   para reusar (§3.2). Esto refuta el "no hay artefacto" de la primera pasada.

Dos ejes para decidir:

1. **Eje externo (el que mató el spike):** RESUELTO. Verifier nativo medido (~81M) y
   drop-in → §3.2.
2. **Eje interno (el costo real ahora):** portar `policy_tx_1_8` a Noir no es portar el
   mixer del spike; es reimplementar el circuito de transacción privacy-pool completo,
   incluido el **SMT non-membership**, con la alineación Poseidon2 circuito↔pool como
   día-killer → §2.

Tercer camino (fallback): backend **Noir→Groth16** que reusa el `CircomGroth16Verifier`
actual, esquivando UltraHonk on-chain (experimental) → §3.5. Plan B si el shape real de
Sobre midiera mal en UltraHonk; hoy el path principal es UltraHonk nativo.

---

## 1. De dónde venimos: qué midió y concluyó el spike

Fuente: `docs/sobre-spike-veredicto.md`, `docs/noir-ultrahonk-base-map.md`,
`.planning/phases/03-spike/`.

| Medición | Resultado | Implicancia |
|---|---|---|
| Verify on-chain UltraHonk (yugocabrio), N=16, shape mínimo (VK_FIELDS=1) | `ExceededLimit` (>400M) | Mata K1 |
| Verify on-chain UltraHonk, N=16, shape alto (VK_FIELDS=20) | `ExceededLimit` (>400M) | Mata K1 |
| Control `simple_circuit` (~2 constraints) | **395.702.543** instr. (98.9% del techo) | El cuello es el VERIFIER, no el gate-count |
| Proving time `bb prove`, N=8 / N=16 | ~222ms / ~369ms | NO es kill-criterion (payroll es async) |

**Causa raíz (la clave de todo):** el crate `ultrahonk_rust_verifier` (yugocabrio)
implementa los pairings BN254 en **Rust puro vía `ark_bn254`**, sin usar las host
functions BN254 nativas de CAP-0074 (X-Ray P25 / Yardstick P26). Cada pairing pasa a
ser cómputo general de Soroban y agota el budget antes de que el circuito real empiece.

**Contraste con el camino que sí funcionó:** `CircomGroth16Verifier` llama
`env.crypto().bn254().pairing_check` (host function nativa) y verifica `policy_tx_1_8`
en **103.898.994 instrucciones** (26% del techo, dato duro de cierre de Phase 4).

**Conclusión del spike, textual:** *"si yugocabrio adoptara CAP-0074, el costo de
verify caería dramáticamente (los pairings serían host calls con costo prefijado,
similar a los precompiles de Ethereum)."* Es decir: el bloqueo nunca fue de UltraHonk
como esquema, sino del verifier disponible. Esa es exactamente la condición que §3 va a
chequear.

---

## 2. Eje interno: qué cuesta reescribir `policy_tx_1_8` en Noir

El spike comparó contra un **mixer tornado de denominación fija** (`H(nullifier,
secret)`, 2 inputs públicos). El circuito que hoy está en producción es mucho más:

`policy_tx_1_8.circom` → `PolicyTransaction(nIns=1, nOuts=8, nMembership=1,
nNonMembership=1, levels=10, smtLevels=10)`. Lo que habría que reimplementar en Noir,
pieza por pieza (todo verificado leyendo `policyTransaction.circom`):

| Pieza Circom | Qué hace | Dificultad de port a Noir |
|---|---|---|
| `Poseidon2(3)` + `domainSeparation` | Commitment `H(amount, pubkey, blinding)` con dominio | **Alta criticidad.** Debe coincidir BYTE-POR-BYTE con `soroban-poseidon` on-chain y con el commitment que ya está en el pool. La trampa día-killer del spike. |
| `Keypair()` / `Signature()` | Posesión de clave + firma `H(privKey, commitment, path)` | Media. Lógica directa pero hay que replicar el esquema exacto. |
| Nullifier `H(commitment, path, signature)` dom `0x02` | Anti-doble-gasto | Media (depende de Poseidon2). |
| `MerkleProof(10)` (inputs) | Inclusión en el árbol del pool | Baja-media. Patrón estándar en Noir. |
| `MerkleProof(10)` (membership/ASP) | Inclusión en allowlist | Baja-media. |
| **`SMTVerifier(10)` (non-membership)** | NO-inclusión en sparse merkle tree | **Alta.** El SMT verifier es la pieza más fiddly; no hay equivalente directo trivial en la stdlib de Noir, hay que portar `smtverifier.circom` + niveles. |
| `Num2Bits(248)` / `Num2Bits(1)` | Range checks (anti-overflow del monto) | Baja. Noir tiene range checks nativos (`as u248` / asserts). Más limpio que en Circom. |
| Unicidad de nullifiers (`IsEqual`) | No repetir nullifiers entre inputs | Baja (con nIns=1 es trivial). |
| Invariante `sumIns + publicAmount === sumOuts` | Conservación = prueba del total | Baja. Es el corazón y es una línea. |
| `extDataHash * extDataHash` | Binding de ext data | Trivial. |

**Lectura honesta del eje interno:**

- Lo que el mapa Noir vendía como ventaja (cero trusted setup, range checks limpios,
  lenguaje fuerte) **sigue siendo cierto** y aplica.
- Pero el costo de reescritura hoy es bastante mayor que cuando se evaluó en
  el 2026-06-13, porque ya no se parte del mixer: se parte de un circuito de
  transacción completo con ASP membership + **non-membership SMT** ya integrado y
  funcionando contra el pool en testnet.
- Las DOS trampas que el propio mapa marcó como "un día cada una" siguen vivas y son
  las más caras: (1) alineación Poseidon2 circuito↔contrato al portar a Noir, y (2)
  serialización de public inputs `[root, publicAmount, extDataHash, inputNullifier,
  outputCommitment×8, membershipRoots, nonMembershipRoots]` en el orden/endianness
  que emite `bb` (falla opaca: verifica local, falla on-chain sin error útil).
- El SMT non-membership es nuevo respecto al alcance que el mapa Noir había planeado
  (el mapa hablaba de "extender el mixer", no de portar un SMT verifier).

**Lo que NO hay que tocar:** el resto de sobrecito (pool, USDC SAC, view-key ECIES,
dashboards, CLI, ops) es agnóstico al sistema de prueba siempre que el contrato
verifier exponga la misma interfaz `verify_proof(public_inputs, proof_bytes)`. La
migración es quirúrgica sobre `packages/zk/circuits` + el contrato verifier. Eso es
real y a favor de Noir.

---

## 3. Eje externo: ¿qué cambió desde el spike? (estado a junio 2026)

Investigación con fuentes primarias (junio 2026). El hallazgo central **matiza el
veredicto del spike**: el problema nunca fue UltraHonk como esquema, era el verifier en
`ark_bn254` puro. Esa pieza hoy es resoluble a nivel protocolo, pero todavía no hay
artefacto listo.

### 3.1. El camino nativo SÍ baja UltraHonk bajo 400M (dato nuevo y duro)

La discusión de diseño de Stellar **#1826 ("Additional new host function for bn254")**
usa el propio verifier UltraHonk como benchmark para justificar las host functions
nuevas, y reporta:

| Métrica | ark_bn254 puro | Con host functions BN254 nativas |
|---|---|---|
| CPU instructions | **557.793.594** | **112.533.176** |
| Tamaño del contrato | 129.522 bytes | 15.385 bytes |

La caída de ~5x viene de tres primitivas: **G1 MSM** (multi-scalar mult), **aritmética
de campo escalar Fr** (add/sub/mul/exp/invert), y **curve-membership (`is_on_curve`)`**.
Son exactamente las que agregó **Protocol 26 ("Yardstick")**, **vivo en mainnet desde
el 6-may-2026**. Es decir: el prerequisito de protocolo está cumplido, no pendiente.
112.5M es del mismo orden que el Groth16 que ya corremos (104M). Confianza: alta.

Fuente: https://github.com/orgs/stellar/discussions/1826

### 3.2. CORRECCIÓN (inspección del repo local): el verifier nativo SÍ existe, está medido y tiene audit trail

La investigación web concluyó "media-baja confianza en que exista un verifier nativo
medido". **La inspección del repo local `Sobre/rs-soroban-ultrahonk` (línea Nethermind,
commit `661db07`, 2026-06-09) lo refuta.** Hechos verificados leyendo el código:

- **Es 100% nativo, sin `ark_bn254`.** `crates/ultrahonk-soroban-verifier/src/ec.rs`
  usa `env.crypto().bn254().g1_msm(...)` (MSM de Yardstick) y
  `env.crypto().bn254().pairing_check(...)`; `field.rs`/`relations.rs` usan `Bn254Fr`
  (aritmética de campo nativa). No hay feature flag arkworks: el crate es nativo a secas
  (`default = []`). Esto es un cambio fuerte vs el spike (Phase 3 = ark puro).
- **Costo MEDIDO en P26:** `contracts/identity/README.md` → *"Verification costs ~81M
  CPU instructions on Soroban Protocol 26."* Es decir **81M < 400M, y más barato que
  nuestro Groth16 actual (104M).** (Circuito identity = Poseidon preimage, simple.)
- **Audit trail real:** `VERIFIER_PROVENANCE.md` documenta correspondencia 1:1 con
  Barretenberg v0.82.2, audit date 2026-05-28, scope "native BN254 UltraHonk path".
  Optimización de MSM documentada (70→65 entries, ~2M instr.). No es auditoría de firma
  externa, pero hay trazabilidad y disciplina de re-auditoría.
- **Drop-in con nuestra arquitectura:** `contracts/rs-soroban-ultrahonk/src/lib.rs`
  expone `__constructor(vk_bytes)` + `verify_proof(public_inputs, proof)`, VK inmutable
  al deploy. **Misma interfaz que `CircomGroth16Verifier`.** Cambiar el verifier es
  swap del contrato, no rediseño del pool.
- **Harness + pipeline listos para reusar:** `scripts/measure_ultrahonk_costs.ts`
  (simula vía RPC, imprime CPU instructions/memoria/fees) y `just testnet`
  (fund→deploy→verify). Hay circuito `many_pubs` (18 public inputs) para medir
  exactamente el escalado de public inputs que nos preocupa.

**Limitaciones del verifier (del `VERIFIER_PROVENANCE.md`), a tener en cuenta:**

| Soportado | NO soportado |
|---|---|
| UltraFlavor (BN254 nativo) | UltraZKFlavor (hiding poly / Libra) |
| Transcript Keccak-256 | Transcript Poseidon2 (Fiat-Shamir) |
| Sumcheck non-ZK, 26 subrelations | Verifier recursivo / stdlib |
| Shplemini (Gemini + Shplonk + KZG) | Mega / Goblin, Rollup / IPA |

Lo de "transcript Poseidon2 no soportado" es del **Fiat-Shamir** (usa Keccak, igual que
el spike con `--oracle_hash keccak`). Es **independiente** del Poseidon2 que el circuito
usa para commitments/Merkle: ese sí lo seguimos usando dentro del circuito.

Confianza: **alta** (código leído localmente). El 81M es para identity; el circuito de
Sobre agrega gates + ~13 public inputs, así que hay que **medir el shape real** (queda
como el primer entregable de la fase), pero el margen contra 400M es amplio.

Fuentes: repo local `Sobre/rs-soroban-ultrahonk` ·
https://github.com/NethermindEth/rs-soroban-ultrahonk · #1826 (benchmark 112.5M)

### 3.3. Toolchain Noir/bb avanzó (pero sin delta de costo confirmado)

nargo pasó de `1.0.0-beta.9` a **`1.0.0-beta.20`** (sigue en beta, sin 1.0.0 final); bb
pasó de `0.87.0` a la línea **`3.0.0-nightly`**; aztec-packages en `v5.0.0-rc.1`
(15-jun-2026). **No** hay evidencia primaria de que el costo/estructura del verifier
UltraHonk haya cambiado materialmente entre bb 0.87 y bb 3.0 (Sumcheck + Shplemini
igual en la descripción). Confianza: alta en versiones, baja en deltas de costo.

### 3.4. Protocolo: P27 en testnet, no aporta nada al verify ZK

Protocol 27 salió a testnet el **18-jun-2026** (voto mainnet 8-jul). Sus features son
**delegated auth para smart accounts** y el **inicio de cripto post-cuántica**. **No
agrega host functions ZK nuevas** y **no cambia `tx_max_instructions` (sigue 400M)**.
Lo relevante para UltraHonk ya está en P26, no en P27. Confianza: alta.

Fuente: https://developers.stellar.org/docs/networks/software-versions

### 3.5. Tercer camino nuevo: Noir → Groth16 (esquiva el problema entero)

Apareció (feb-2026) un backend experimental que baja **Noir → ACIR → R1CS → Groth16**
(vía snarkjs), salteando UltraHonk por completo, y **demuestra verificación en
Stellar**. Implicancia directa para nosotros: emitiría un Groth16 que el
**`CircomGroth16Verifier` que YA tenemos** (104M, `pairing_check` nativo) verifica sin
tocar el contrato. Permitiría escribir el circuito en Noir y conservar el verifier
barato. Caveat del propio autor: "experimental, sin auditar, no apto para producción",
cubre solo un subset de opcodes ACIR. No hay wrapper productizado Honk→Groth16 desde bb.

Fuente: https://jamesbachini.com/noir-groth16/

### 3.6. Sobre el caveat temporal

El spike fue el 14-jun y hoy es 21-jun (7 días). **No hubo cambio de ecosistema de fondo
en esa semana**: el dato que mueve la aguja (#1826, las host functions) es de enero-2026,
P26 es de mayo-2026, y el verifier nativo `rs-soroban-ultrahonk` con su costo medido (81M)
trae audit date 2026-05-28. O sea **todo ya era cierto el día del spike**. Lo que el spike
no capturó no fue un cambio posterior: midió el default `ark_bn254` (el verifier que tenía
a mano ese día) y concluyó "UltraHonk no entra", cuando lo preciso es "el verifier
`ark_bn254` no entra; **el nativo sí, y ya estaba medido y disponible**". El spike acertó
en el número que midió y erró en la generalización.

---

## 4. Veredicto

### Migración VIABLE. Se hace como fase dedicada, con un spike de medición como puerta de entrada.

El bloqueo que mató el spike (verifier `ark_bn254` >400M) está resuelto: existe un verifier
UltraHonk **nativo, medido (~81M en P26), con audit trail y drop-in** (`rs-soroban-ultrahonk`).
Sumado a la razón estratégica (aplicar a un **track de Noir**), la migración deja de ser
"cambiar lo que funciona por capricho" y pasa a tener upside claro: encaje de track + las
ventajas de Noir (cero trusted setup por circuito, iterar el circuito es recompilar con
`bb` sin ceremonia, lenguaje fuerte para el SMT y la conservación).

**Dónde está ahora el riesgo (todo interno, §2):**

1. **El port del circuito.** `policy_tx_1_8` completo a Noir: Poseidon2 con domain
   separation, Keypair/Signature, nullifiers, MerkleProof, ASP membership y el **SMT
   non-membership** (la pieza más fiddly, sin equivalente directo en la stdlib de Noir).
2. **Alineación Poseidon2 circuito↔pool (día-killer).** El hash del circuito Noir debe
   coincidir byte-por-byte con el `soroban-poseidon` que el pool usa para commitments y el
   frontier Merkle. Mitigación obligatoria: harness de cross-check en CI (hash del witness
   Noir == hash on-chain, mismos inputs) antes de cualquier otra cosa.
3. **Serialización de public inputs.** `[root, publicAmount, extDataHash, inputNullifier,
   outputCommitment×8, membershipRoots, nonMembershipRoots]` en el orden/endianness que
   emite `bb`, más el pairing-point-object. Falla opaca (verifica local, falla on-chain).
4. **Medir el shape real.** 81M es identity (simple). El circuito de Sobre agrega gates +
   ~13 public inputs. Hay que medir con el harness (`measure_ultrahonk_costs.ts` +
   `many_pubs`) y confirmar <400M antes de comprometer el resto. **Sin número propio no se
   avanza** (disciplina del spike, sin excepción).

### Disclosure a corregir en los docs existentes

La afirmación del spike ("UltraHonk excede el techo de Soroban") es engañosa y conviene
suavizarla: lo preciso es **"el verifier UltraHonk en `ark_bn254` puro excede el techo; el
verifier nativo (`rs-soroban-ultrahonk`) verifica en ~81M y entra cómodo"**. Afecta el
banner de `docs/noir-ultrahonk-base-map.md` y el veredicto en `docs/sobre-spike-veredicto.md`.

### Plan B dentro de la fase

Si el shape real de Sobre midiera mal en UltraHonk nativo (improbable dado el margen), el
fallback es el backend **Noir→Groth16** (§3.5): se reusa el `CircomGroth16Verifier` que ya
está medido, conservando Noir como lenguaje del circuito. Riesgo: backend experimental,
subset de opcodes.

### Resumen en una tabla

| Camino | Verify on-chain | Estado jun-2026 | Costo de migrar | Veredicto |
|---|---|---|---|---|
| Circom + Groth16 (actual) | 104M ✅ medido propio | Funcionando, en repo | 0 | Base de la que partimos |
| **Noir + UltraHonk nativo** | **~81M medido (identity, P26)** | **Verifier local `rs-soroban-ultrahonk`, audit trail, drop-in** | Alto (reescribir circuito + SMT) | **Path principal de la fase** |
| Noir + UltraHonk `ark_bn254` | >400M ❌ | El que mató el spike | Alto | Descartado |
| Noir → Groth16 (backend) | 104M (reusa verifier actual) | Experimental, subset de opcodes | Medio (port circuito, reusa verifier) | Plan B de la fase |

---

## Apéndice: comando para reproducir el contexto

```
# circuito actual
sobrecito/packages/zk/circuits/src/policy_tx_1_8.circom
sobrecito/packages/zk/circuits/src/policyTransaction.circom

# verifier actual (usa host function nativa)
sobrecito/packages/zk/contracts/circom-groth16-verifier/src/lib.rs:99,135

# spike original
docs/sobre-spike-veredicto.md
docs/noir-ultrahonk-base-map.md   (banner "SUPERADO")
.planning/phases/03-spike/03-MEASUREMENTS.md
ultrahonk_soroban_contract/       (verifier del spike: ark_bn254 puro, >400M)

# verifier UltraHonk NATIVO (el que destraba la migración)
rs-soroban-ultrahonk/crates/ultrahonk-soroban-verifier/src/ec.rs   (g1_msm + pairing_check nativos)
rs-soroban-ultrahonk/crates/ultrahonk-soroban-verifier/VERIFIER_PROVENANCE.md
rs-soroban-ultrahonk/contracts/identity/README.md                 (~81M en P26, medido)
rs-soroban-ultrahonk/scripts/measure_ultrahonk_costs.ts           (harness de costos)
rs-soroban-ultrahonk/circuits/many_pubs/                          (test de escalado de public inputs)
```
