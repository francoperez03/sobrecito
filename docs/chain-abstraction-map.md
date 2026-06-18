# Mapa de acoplamiento blockchain + diseño de adapter — `sobrecito/apps/web`

> **Paso de identificación.** Este documento NO modifica código. Inventaria cada punto
> donde la app activa toca la cadena (Stellar/Soroban) o la wallet (Freighter), y propone
> la forma de un `ChainAdapter` para un refactor futuro que permita desplegar en más
> blockchains sin reescribir el dominio (ZK proving, cripto de notas, parsing CSV).
> Alcance: solo `sobrecito/apps/web` (+ el paquete `viewkey` que la app consume). El
> frontend legacy `stellar-private-payments/app` queda fuera.

Hallazgo de fondo: **no hay backend**. Todo el contacto con la cadena es client-side
(privacidad A1: el servidor nunca ve montos ni destinatarios). El adapter vive en el browser.

---

## Parte A — Dónde están los contratos

La app activa consume **solo** los IDs de `sobrecito/ops/deployments/testnet/deployments.json`
(RPC URL, pool, token USDC SAC, ASP membership/non-membership, verifier, `auditorPubkeyHex`,
`deploymentLedger`).

Código fuente de los contratos (copias en el monorepo, `sobrecito/packages/zk/contracts/`):

| Contrato | Path | Interfaz relevante para la web |
|----------|------|-------------------------------|
| Pool (pagos privados) | `packages/zk/contracts/pool/src/pool.rs` | `transact(proof, ext_data, sender)`, `get_root()`, `register(account)`, `is_spent()` (privada), `get_proof()` (ausente). Eventos: `NewCommitment`, `Deposit`, `Withdraw`, `PublicKey` |
| ASP membership | `packages/zk/contracts/asp-membership/src/lib.rs` | `get_root()`, `insert_leaf()` |
| ASP non-membership | `packages/zk/contracts/asp-non-membership/src/lib.rs` | `get_root()`, `verify_non_membership()` |
| Verifier Groth16 | `packages/zk/contracts/circom-groth16-verifier/src/lib.rs` | `verify(proof, public_inputs)` (VK embebida en build) |
| USDC | SAC en testnet (ID en `deployments.json`) | `balance(address)` |

Circuito ZK que prueba la web: `policy_tx_1_8` (1-in / 8-out, Groth16/BN254). Artefactos
servidos desde `sobrecito/apps/web/public/zk/` (wasm, r1cs, proving key, prover/witness WASM).

> Existen además la base `ultrahonk_soroban_contract` (verifier UltraHonk + mixer Noir) y
> los contratos espejo en `stellar-private-payments/contracts`, pero la app activa NO los usa.

---

## Parte B — Inventario de acoplamiento

Cada punto de contacto, agrupado por la responsabilidad que absorbería el adapter (seam).

### B1. Configuración de red / contratos → seam `ChainConfig`
- `lib/rpc.ts:21` `readDeployments()` — única fuente de IDs + RPC URL; importa `deployments.json` directo.
- RPC URL + passphrase de testnet + `BASE_FEE` **hardcodeados y duplicados** en tres archivos:
  `lib/rpc.ts:23`, `lib/employer-deposit.ts:46-49`, `lib/employee-unshield.ts:44-47`.

### B2. Conexión / red / firma de wallet → seam `WalletAdapter`
- `lib/employer-deposit.ts:107` `unwrapFreighter()`, `:126` `connectFreighter()` — `requestAccess` / `getAddress` / `getNetwork` + guard de passphrase testnet.
- `lib/employee-unshield.ts:110` `unshieldNote()` — connect / network-check / sign.
- `lib/employee-claim.ts:42,74` `claimNote()` — `requestAccess` → `getNetwork` → `getAddress`.
- Firma: `signTransaction` (`@stellar/freighter-api`) en `employer-deposit.ts:189` y `employee-unshield.ts:139`.
- UI: `components/employer/ConnectFreighter.tsx` — botón de conexión + estado + balance.

### B3. Lectura de estado on-chain (simulación) → seam `ChainReader`
Todas en `lib/rpc.ts`, mismo patrón `Server.simulateTransaction(Contract.call(...))`:

| Función | Línea | Qué lee |
|---------|-------|---------|
| `fetchPoolRoot()` | `:97` | root Merkle del pool (decimal string para el witness) |
| `fetchASPRoots()` | `:123` | roots ASP membership / non-membership |
| `readPoolUsdcBalance()` | `:164` | balance USDC del pool (SAC) |
| `fetchUsdcBalance(addr)` | `:190` | balance USDC de una cuenta |
| `fetchNullifierStatus()` | `:225` | `is_spent` (best-effort, A1) |
| `fetchMerkleProof()` + `MerkleProofUnavailableError` | `:274` / `:256` | `get_proof` (ausente → fallback A2) |
| `fetchBatchExtAmount(txHash)` | `:65` | decodifica XDR de la tx para leer `ext_amount` |

### B4. Construcción + envío de transacciones → seam `ChainWriter`
- `lib/employer-deposit.ts:161` `submitDeposit()` + `:221` `buildDepositTransaction()` — arma `pool.transact`, `prepareTransaction`, `signTransaction`, `sendTransaction`.
- `lib/employee-unshield.ts:167` `buildUnshieldTransaction()` + `unshieldNote()` — mismo patrón para retiro (`ext_amount` negativo).
- `lib/zk/proofArg.ts:50,83` `groth16ProofScVal()` / `buildProofScVal()` — serializa el `Proof` a `ScVal` (split A/B/C, ScMap). **Encoding específico de Soroban.**
- `lib/zk/depositTransactionBuilder.ts:65` `hashExtDataSobre()` — keccak(XDR(ExtData)) mod BN254. **Acoplado a serialización XDR.**

### B5. Eventos / reconstrucción Merkle → seam `ChainEventScanner`
El scanner de eventos vive en el **paquete `viewkey`** (no en `apps/web`), y también acopla Stellar:
- `packages/viewkey/src/scanner/eventScanner.ts:1-2` — importa `@stellar/stellar-sdk` + `Server` (RPC). Define `scanCommitmentEvents()` / `scanSpentNullifiers()`.
- `packages/viewkey/src/types.ts:2` — importa `StrKey` de `@stellar/stellar-sdk`.

Consumidores en la app:
- `app/(demo)/employer/page.tsx:6,63` `scan()` → `scanCommitmentEvents(...)`.
- `app/(demo)/employee/page.tsx:30,176` — `scanCommitmentEvents` / `scanSpentNullifiers`.
- `lib/employee-scan.ts:24,81` `scanEmployeeNotes()` / `reconstructMerklePathFromEvents()` — scan + decrypt + rebuild tree (A2).
- `app/(demo)/auditor/page.tsx:143` `reconstructBatch()` — scan + decrypt mitad auditor.

### B6. Dominio agnóstico — NO va al adapter de cadena
Lógica de negocio portable; el adapter no debe absorberla:
- ZK proving: `lib/zk/proverClient.ts`, `public/zk/*` (worker, prover, bridge, witness builders).
- Cripto de notas: `lib/zk/keyDerivation.ts`, `depositTransactionBuilder.ts` / `withdrawTransactionBuilder.ts` (witness, blobs ECIES), Poseidon2.
- Parsing roster/CSV: `lib/employeeRoster.ts`, `lib/csvParser.ts`.
- Pubkey del auditor en localStorage: `lib/auditorKeyStore.ts` (cripto de producto, no de cadena).

---

## Parte C — Diseño de la interfaz del adapter

`ChainAdapter` que el dominio consume, con una implementación `StellarAdapter` hoy y espacio
para `EvmAdapter`/otros. El dominio (B6) le pasa **valores semánticos** (proof bytes, public
inputs, montos, commitments); el adapter hace el encoding por cadena (ScVal/XDR o calldata).

```ts
interface ChainConfig {
  rpcUrl: string
  networkId: string            // hoy = networkPassphrase; mañana = chainId genérico
  poolId, usdcId, aspMembershipId, aspNonMembershipId: string
  deployer: string
  baseFee: string
}

interface WalletAdapter {
  connect(): Promise<{ address: string }>
  getNetwork(): Promise<{ networkId: string }>
  assertExpectedNetwork(): Promise<void>          // absorbe el guard de passphrase
  signTx(unsignedTx: UnsignedTx): Promise<SignedTx>
}

interface ChainReader {
  poolRoot(): Promise<string>                      // decimal string
  aspRoots(): Promise<{ memberRoot: string; nonMemberRoot: string }>
  usdcBalance(address: string): Promise<bigint>
  poolUsdcBalance(): Promise<bigint>
  nullifierSpent(nullifier: bigint): Promise<boolean>  // best-effort
  merkleProof(index: number): Promise<MerklePath>      // puede lanzar Unavailable
  batchExtAmount(txHash: string): Promise<bigint | null>
}

interface ChainEventScanner {
  scanCommitments(fromLedger: number): Promise<CommitmentEvent[]>
  scanSpentNullifiers(fromLedger: number): Promise<bigint[]>
}

interface ChainWriter {
  // recibe valores semánticos, hace el encoding internamente (ScVal hoy)
  buildDeposit(args: DepositArgs): UnsignedTx       // proof, publicInputs, encOutputs, amount, sender
  buildWithdraw(args: WithdrawArgs): UnsignedTx
  submit(signedTx: SignedTx): Promise<{ hash: string }>
}

interface ChainAdapter {
  config: ChainConfig
  wallet: WalletAdapter
  reader: ChainReader
  writer: ChainWriter
  events: ChainEventScanner
  explorerTxUrl(hash: string): string
}
```

Lo que el `StellarAdapter` encapsularía (hoy disperso): `@stellar/stellar-sdk`,
`@stellar/freighter-api`, `buildProofScVal`/`groth16ProofScVal` (encoding ScVal),
`hashExtDataSobre` (XDR), passphrase/RPC/fee, todas las funciones de `rpc.ts`, y el
`eventScanner.ts` de `viewkey`. El dominio dejaría de importar el SDK de Stellar directamente.

---

## Parte D — Tabla "archivo actual → seam destino"

| Archivo / símbolo actual | Importa Stellar SDK | Seam destino |
|--------------------------|:-------------------:|--------------|
| `lib/rpc.ts` (config + `fetch*`) | sí (`:9-10`) | `ChainConfig` + `ChainReader` |
| `lib/employer-deposit.ts` | sí (`:36`, `:42`) | `WalletAdapter` + `ChainWriter` |
| `lib/employee-unshield.ts` | sí (`:36`, `:42`) | `WalletAdapter` + `ChainWriter` |
| `lib/employee-claim.ts` | sí (`:42`) | `WalletAdapter` (orquesta dominio + writer) |
| `lib/zk/proofArg.ts` | sí (`:30`) | `ChainWriter` (encoding ScVal) |
| `lib/zk/depositTransactionBuilder.ts` | sí (`:24`) | parte XDR → `ChainWriter`; witness/blobs → dominio (B6) |
| `components/employer/ConnectFreighter.tsx` | vía lib | UI sobre `WalletAdapter` |
| `packages/viewkey/src/scanner/eventScanner.ts` | sí (`:1-2`) | `ChainEventScanner` |
| `packages/viewkey/src/types.ts` (`StrKey`) | sí (`:2`) | `ChainConfig`/util de address |
| `lib/zk/proverClient.ts`, `keyDerivation.ts`, `csvParser.ts`, `employeeRoster.ts`, `auditorKeyStore.ts` | no | **dominio (B6) — NO toca el adapter** |

### Inventario de control (todos los imports de Stellar/Freighter en el alcance)
```
apps/web/lib/rpc.ts:9                         @stellar/stellar-sdk
apps/web/lib/rpc.ts:10                        @stellar/stellar-sdk/rpc
apps/web/lib/employer-deposit.ts:36           @stellar/stellar-sdk
apps/web/lib/employer-deposit.ts:42           @stellar/freighter-api
apps/web/lib/employee-claim.ts:42             @stellar/freighter-api
apps/web/lib/employee-unshield.ts:36          @stellar/stellar-sdk
apps/web/lib/employee-unshield.ts:42          @stellar/freighter-api
apps/web/lib/zk/depositTransactionBuilder.ts:24   @stellar/stellar-sdk (Address, XdrLargeInt, xdr)
apps/web/lib/zk/proofArg.ts:30                @stellar/stellar-sdk (XdrLargeInt, xdr)
packages/viewkey/src/scanner/eventScanner.ts:1-2  @stellar/stellar-sdk + /rpc
packages/viewkey/src/types.ts:2               @stellar/stellar-sdk (StrKey)
```
Regla de cierre: tras el refactor, ningún import de `@stellar/*` debería quedar fuera del
futuro `StellarAdapter`. `depositTransactionBuilder.ts` es el único archivo mixto (witness =
dominio, XDR de `ExtData` = cadena): hay que separar esas dos responsabilidades.

---

## Fuera de alcance (este paso)
- Implementar el adapter o refactorizar archivos.
- Frontend legacy `stellar-private-payments/app`.
- Tocar contratos o deployments.
