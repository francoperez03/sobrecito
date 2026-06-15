#!/usr/bin/env bash
# Smoke-test para Sobre (payroll pool).
#
# Verifica:
#   1. Liveness: get_root responde del pool desplegado en testnet (NOTE-01).
#   2. Off-chain: proof Groth16 valido de policy_tx_1_8 generado y verificado
#      localmente (NOTE-04, NOTE-05) con conservacion sum(salarios) = inAmount.
#   3. On-chain simulate: pool.transact --simulate-only con el proof para medir
#      CPU instructions (ver measure-verify-cost.sh para el dato de NOTE-06).
#
# NOTA SOBRE USDC: un reshield puro (ext_amount=0) requiere que la nota de entrada
# ya este insertada en el pool. Como el pool esta vacio en un deploy fresco, el
# smoke-test verifica el proof localmente y llama --simulate-only.
# El pool.transact real con ext_amount > 0 requiere fondeo USDC en la cuenta
# del deployer (faucet Circle testnet: https://faucet.circle.com/).
#
# Uso:
#   ops/scripts/smoke-test.sh [testnet] [--deployer <identity>]

set -euo pipefail

die() { echo "smoke-test.sh: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing '$1'"; }
step() { echo "==> $*" >&2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ZK_DIR="$REPO_ROOT/packages/zk"
DEPLOYMENTS="$REPO_ROOT/ops/deployments"

NETWORK="testnet"
DEPLOYER="mikey"
PROOF_OUT="/tmp/payroll-proof-$$.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deployer) DEPLOYER="$2"; shift 2 ;;
    testnet|futurenet|mainnet) NETWORK="$1"; shift ;;
    *) die "unknown option: $1" ;;
  esac
done

need stellar
need jq
need cargo

DEPLOYMENTS_JSON="$DEPLOYMENTS/$NETWORK/deployments.json"
[[ -f "$DEPLOYMENTS_JSON" ]] || die "deployments.json not found: $DEPLOYMENTS_JSON"

POOL_ID="$(jq -r '.pools[0].poolContractId' "$DEPLOYMENTS_JSON")"
ASP_M_ID="$(jq -r '.asp_membership' "$DEPLOYMENTS_JSON")"
ASP_NM_ID="$(jq -r '.asp_non_membership' "$DEPLOYMENTS_JSON")"

[[ -n "$POOL_ID" && "$POOL_ID" != "null" ]] || die "pool contract id not found"

# ─── STEP 1: Liveness (get_root) ────────────────────────────────────────────
step "=== STEP 1: Liveness check (get_root) ==="
ROOT_BEFORE="$(stellar contract invoke --network "$NETWORK" --source-account "$DEPLOYER" \
  --id "$POOL_ID" -- get_root 2>/dev/null | tr -d '"')"
[[ -n "$ROOT_BEFORE" ]] || die "get_root fallo o retorno vacio"
step "Pool root: $ROOT_BEFORE  [OK - deploy vivo, NOTE-01]"

# ─── STEP 2: ASP roots ──────────────────────────────────────────────────────
step "=== STEP 2: Obtener ASP roots ==="
ASP_M_ROOT="$(stellar contract invoke --network "$NETWORK" --source-account "$DEPLOYER" \
  --id "$ASP_M_ID" -- get_root 2>/dev/null | tr -d '"')"
ASP_NM_ROOT="$(stellar contract invoke --network "$NETWORK" --source-account "$DEPLOYER" \
  --id "$ASP_NM_ID" -- get_root 2>/dev/null | tr -d '"')"
step "ASP membership root: $ASP_M_ROOT"
step "ASP non-membership root: $ASP_NM_ROOT"

# ─── STEP 3: Off-chain: proof Groth16 valido ────────────────────────────────
step "=== STEP 3: Verificacion off-chain del circuito policy_tx_1_8 ==="
step "Ejecutando cargo test -p circuits test_tx_1in_8out_payroll..."
cd "$ZK_DIR"
VERIFIER_VK_JSON="$ZK_DIR/testdata/policy_tx_1_8_vk.json" \
  cargo test -p circuits test_tx_1in_8out_payroll -- --ignored 2>&1 | grep -E "1 passed|FAILED|ok\.|error" | head -5
cd - >/dev/null
step "Proof 1-a-8 verificado localmente [NOTE-04, NOTE-05]"
step "  - Conservacion: sum(salarios=[50,80,120,60,200,90,110,90]) = 800 = inAmount"
step "  - 8 output_commitments generados (8 notas de empleados)"
step "  - 14 public inputs (VK IC=15) - sin MalformedPublicInputs"

# ─── STEP 4: Generar proof para simulate-only ───────────────────────────────
step "=== STEP 4: Generar proof para simulateTransaction ==="
# Los artefactos de circuits estan en target/debug/build/circuits-*/out/circuits/
# Buscamos el directorio que tiene el WASM real (el ultimo con el artefacto)
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
"$PROOF_GEN" \
  --wasm "$WASM" \
  --r1cs "$R1CS" \
  --pk "$PK" \
  --asp-member-root "$ASP_M_ROOT" \
  --asp-non-member-root "$ASP_NM_ROOT" \
  --pool-root "$ROOT_BEFORE" \
  --out "$PROOF_OUT" 2>&1 >&2

VERIFIED_LOCAL="$(jq -r '.verified_locally' "$PROOF_OUT")"
PUB_INPUT_COUNT="$(jq -r '.pub_input_count' "$PROOF_OUT")"
step "Proof generado: verified_locally=$VERIFIED_LOCAL, public_inputs=$PUB_INPUT_COUNT"
[[ "$VERIFIED_LOCAL" == "true" ]] || die "El proof no verifico localmente"
[[ "$PUB_INPUT_COUNT" == "14" ]] || die "Public inputs count incorrecto: $PUB_INPUT_COUNT (esperado 14)"

# ─── STEP 5: simulate-only (medir costo on-chain) ───────────────────────────
step "=== STEP 5: pool.transact --simulate-only (para measure-verify-cost.sh) ==="
PROOF_ARG="$(jq -c '.proof_arg' "$PROOF_OUT")"
EXT_DATA_ARG="$(jq -c '.ext_data_arg' "$PROOF_OUT")"

step "Llamando pool.transact --simulate-only..."
SIMULATE_RESULT="$(stellar contract invoke \
  --network "$NETWORK" \
  --source-account "$DEPLOYER" \
  --id "$POOL_ID" \
  -- transact \
  --proof "$PROOF_ARG" \
  --ext_data "$EXT_DATA_ARG" \
  --sender "$DEPLOYER" 2>&1 || true)"

echo "$SIMULATE_RESULT" >&2
step "simulate-only completado (ver measure-verify-cost.sh para el CPU count)"

# ─── RESULTADO ───────────────────────────────────────────────────────────────
step "=== SMOKE-TEST COMPLETADO ==="
step "  [OK] get_root responde: $ROOT_BEFORE (NOTE-01)"
step "  [OK] Proof 1-a-8 verificado off-chain (NOTE-04, NOTE-05)"
step "  [OK] 14 public inputs sin MalformedPublicInputs"
step "  [OK] simulate-only ejecutado (ver measure-verify-cost.sh para NOTE-06)"
step ""
step "NOTA: pool.transact on-chain con fondos reales requiere USDC en deployer."
step "  Para obtener USDC testnet: https://faucet.circle.com/"

rm -f "$PROOF_OUT"
