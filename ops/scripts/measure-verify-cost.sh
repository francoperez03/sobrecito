#!/usr/bin/env bash
# Mide el verify cost de pool.transact via simulateTransaction.
#
# Cierra el hueco honesto del spike de Phase 3: Enclave erro con
# MalformedPublicInputs antes del pairing_check, por lo que nunca midio
# el costo real del verify con un proof valido.
#
# Este harness mide pool.transact COMPLETA (D-09, NOTE-06), no el
# verify_proof aislado. Usa un proof valido del circuito policy_tx_1_8
# generado por payroll-proof-gen.
#
# El techo es 400,000,000 CPU instructions (limite de Soroban).
# Salida: VERDE si cpuInsns < 400M, ROJO si >= 400M.
# Exit 0: VERDE, exit 1: ROJO o error.
#
# Uso:
#   ops/scripts/measure-verify-cost.sh [testnet] [--deployer <identity>]

set -euo pipefail

die() { echo "measure-verify-cost.sh: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing '$1'"; }
step() { echo "==> $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ZK_DIR="$REPO_ROOT/packages/zk"
DEPLOYMENTS="$REPO_ROOT/ops/deployments"

NETWORK="testnet"
DEPLOYER="mikey"
PROOF_OUT="/tmp/payroll-measure-proof-$$.json"
RPC_URL="https://soroban-testnet.stellar.org"
CEILING=400000000

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployer) DEPLOYER="$2"; shift 2 ;;
    testnet|futurenet|mainnet) NETWORK="$1"; shift ;;
    *) die "unknown option: $1" ;;
  esac
done

need stellar
need jq
need curl
need cargo

DEPLOYMENTS_JSON="$DEPLOYMENTS/$NETWORK/deployments.json"
[[ -f "$DEPLOYMENTS_JSON" ]] || die "deployments.json not found: $DEPLOYMENTS_JSON"

POOL_ID="$(jq -r '.pools[0].poolContractId' "$DEPLOYMENTS_JSON")"
ASP_M_ID="$(jq -r '.asp_membership' "$DEPLOYMENTS_JSON")"
ASP_NM_ID="$(jq -r '.asp_non_membership' "$DEPLOYMENTS_JSON")"

# ─── STEP 1: Obtener roots actuales ─────────────────────────────────────────
step "=== Obteniendo roots on-chain ==="
POOL_ROOT="$(stellar contract invoke --network "$NETWORK" --source-account "$DEPLOYER" \
  --id "$POOL_ID" -- get_root 2>/dev/null | tr -d '"')"
ASP_M_ROOT="$(stellar contract invoke --network "$NETWORK" --source-account "$DEPLOYER" \
  --id "$ASP_M_ID" -- get_root 2>/dev/null | tr -d '"')"
ASP_NM_ROOT="$(stellar contract invoke --network "$NETWORK" --source-account "$DEPLOYER" \
  --id "$ASP_NM_ID" -- get_root 2>/dev/null | tr -d '"')"

step "Pool root: $POOL_ROOT"
step "ASP membership root: $ASP_M_ROOT"
step "ASP non-membership root: $ASP_NM_ROOT"

# ─── STEP 2: Generar proof valido ────────────────────────────────────────────
step "=== Generando proof valido para policy_tx_1_8 ==="

CIRCUIT_BUILD_DIR=""
for d in "$ZK_DIR/target/debug/build"/circuits-*/out/circuits; do
  if [[ -f "$d/wasm/policy_tx_1_8_js/policy_tx_1_8.wasm" ]]; then
    CIRCUIT_BUILD_DIR="$d"
  fi
done
[[ -n "$CIRCUIT_BUILD_DIR" ]] || die "No se encontro el directorio de artefactos de circuits. Corre: cd $ZK_DIR && VERIFIER_VK_JSON=\$PWD/testdata/policy_tx_1_8_vk.json cargo build -p circuits"

WASM="$CIRCUIT_BUILD_DIR/wasm/policy_tx_1_8_js/policy_tx_1_8.wasm"
R1CS="$CIRCUIT_BUILD_DIR/policy_tx_1_8.r1cs"
PK="$ZK_DIR/testdata/policy_tx_1_8_proving_key.bin"
PROOF_GEN="$ZK_DIR/target/debug/payroll-proof-gen"

[[ -f "$WASM" ]] || die "WASM not found: $WASM"
[[ -f "$R1CS" ]] || die "R1CS not found: $R1CS"
[[ -f "$PK" ]] || die "proving key not found: $PK"

if [[ ! -f "$PROOF_GEN" ]]; then
  step "Compilando payroll-proof-gen..."
  cd "$ZK_DIR"
  VERIFIER_VK_JSON="$ZK_DIR/testdata/policy_tx_1_8_vk.json" cargo build -p payroll-proof-gen 2>&1 >&2
  cd - >/dev/null
fi

step "Generando proof (puede tardar ~30s)..."
# --blinding se varía por timestamp para evitar colisión de nullifier con runs anteriores.
# El priv_key (424242) se mantiene fijo para que pk_field coincida con el employer leaf
# en el árbol ASP membership on-chain (leaf[8] = poseidon2_hash2(pk_424242, 0, 1)).
FRESH_BLINDING=$(($(date +%s) % 1000000000 + 1000000))
"$PROOF_GEN" \
  --wasm "$WASM" \
  --r1cs "$R1CS" \
  --pk "$PK" \
  --asp-member-root "$ASP_M_ROOT" \
  --asp-non-member-root "$ASP_NM_ROOT" \
  --pool-root "$POOL_ROOT" \
  --zero-input \
  --blinding "$FRESH_BLINDING" \
  --out "$PROOF_OUT" 2>&1 >&2

VERIFIED_LOCAL="$(jq -r '.verified_locally' "$PROOF_OUT")"
[[ "$VERIFIED_LOCAL" == "true" ]] || die "El proof no verifico localmente - abortando medicion"

PUB_INPUT_COUNT="$(jq -r '.pub_input_count' "$PROOF_OUT")"
step "Proof generado y verificado localmente. Public inputs: $PUB_INPUT_COUNT"

PROOF_ARG="$(jq -c '.proof_arg' "$PROOF_OUT")"
EXT_DATA_ARG="$(jq -c '.ext_data_arg' "$PROOF_OUT")"

# ─── STEP 3: simulateTransaction via stellar CLI ─────────────────────────────
step "=== Midiendo verify cost via simulateTransaction ==="
step "(pool.transact completa: root check + nullifier + ext_hash + public_amount + ASP + pairing)"

# Usar --send=no para obtener el resultado de la simulacion sin enviar la tx real.
# La salida del CLI incluye el JSON con cost.cpuInsns cuando hay ledger writes.
CPU_INSNS=""

SIMULATE_OUTPUT="$(stellar contract invoke \
  --network "$NETWORK" \
  --source-account "$DEPLOYER" \
  --id "$POOL_ID" \
  --send=no \
  -- transact \
  --proof "$PROOF_ARG" \
  --ext_data "$EXT_DATA_ARG" \
  --sender "$DEPLOYER" 2>&1 || true)"

echo "$SIMULATE_OUTPUT" >&2

# El CLI con --send=no emite JSON de simulacion que incluye cpuInsns
CPU_INSNS="$(echo "$SIMULATE_OUTPUT" | grep -oE '"cpuInsns":"[0-9]+"' | grep -oE '[0-9]+' | head -1 || true)"

# Fallback: construir el XDR con --build-only y simular via RPC directo.
# El RPC Soroban moderno expone cpuInsns en result.transactionData (SorobanTransactionData XDR)
# decodificado como .resources.instructions, no en result.cost.cpuInsns.
if [[ -z "$CPU_INSNS" ]]; then
  step "CLI no reporto cpuInsns en --send=no. Intentando RPC directo via curl..."

  # --build-only escribe el XDR a stdout (sin ninguna otra salida en stdout)
  TX_XDR="$(stellar contract invoke \
    --network "$NETWORK" \
    --source-account "$DEPLOYER" \
    --id "$POOL_ID" \
    --build-only \
    -- transact \
    --proof "$PROOF_ARG" \
    --ext_data "$EXT_DATA_ARG" \
    --sender "$DEPLOYER" 2>/dev/null || true)"

  if [[ -n "$TX_XDR" ]]; then
    step "XDR obtenido (${#TX_XDR} chars). Enviando a simulateTransaction RPC..."

    RPC_RESPONSE="$(curl -s -X POST "$RPC_URL" \
      -H "Content-Type: application/json" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"simulateTransaction\",\"params\":{\"transaction\":\"$TX_XDR\"}}" 2>/dev/null || true)"

    if [[ -n "$RPC_RESPONSE" ]]; then
      # Nuevo Soroban RPC: cpuInsns en transactionData.resources.instructions (XDR decodificado)
      TX_DATA_XDR="$(echo "$RPC_RESPONSE" | jq -r '.result.transactionData // empty' 2>/dev/null || true)"
      if [[ -n "$TX_DATA_XDR" ]]; then
        CPU_INSNS="$(echo "$TX_DATA_XDR" | stellar xdr decode --type SorobanTransactionData --output json 2>/dev/null \
          | jq -r '.resources.instructions // empty' 2>/dev/null || true)"
      fi
      # Fallback legacy: result.cost.cpuInsns
      if [[ -z "$CPU_INSNS" ]]; then
        CPU_INSNS="$(echo "$RPC_RESPONSE" | jq -r '.result.cost.cpuInsns // empty' 2>/dev/null || true)"
      fi
      step "CPU insns extraidos del RPC: ${CPU_INSNS:-NO ENCONTRADO}"
    fi
  fi
fi

# ─── STEP 4: Emitir veredicto ────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║              MEDICION VERIFY COST — Sobre payroll               ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Circuito:    policy_tx_1_8 (1 input, 8 outputs payroll)        ║"
echo "║  Techo:       400,000,000 CPU instructions (limite Soroban)     ║"
echo "╠══════════════════════════════════════════════════════════════════╣"

if [[ -n "$CPU_INSNS" && "$CPU_INSNS" =~ ^[0-9]+$ ]]; then
  PCT=$(( CPU_INSNS * 100 / CEILING ))
  if [[ "$CPU_INSNS" -lt "$CEILING" ]]; then
    VERDICT="VERDE"
    SYMBOL="✓"
    EXIT_CODE=0
  else
    VERDICT="ROJO"
    SYMBOL="✗"
    EXIT_CODE=1
  fi
  printf "║  CPU insns:   %-20s (%d%% del techo)         ║\n" "$CPU_INSNS" "$PCT"
  printf "║  Veredicto:   %s %-60s ║\n" "$SYMBOL" "$VERDICT"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "cpuInsns=$CPU_INSNS" >&2
  echo "techo=$CEILING" >&2
  echo "veredicto=$VERDICT" >&2
  rm -f "$PROOF_OUT"
  exit "$EXIT_CODE"
else
  # No se pudo obtener cpuInsns del CLI/RPC.
  echo "║  CPU insns:   NO MEDIDO (fallo de extraccion del RPC)           ║"
  echo "║  Veredicto:   PENDIENTE - revisar salida del RPC arriba         ║"
  echo "╚══════════════════════════════════════════════════════════════════╝"
  rm -f "$PROOF_OUT"
  exit 1
fi
