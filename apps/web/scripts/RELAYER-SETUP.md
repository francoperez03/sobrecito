# OZ Relayer — Setup para el spike gasless de Sobre

Checklist concreto para levantar el OZ Relayer con el Channels plugin en modo testnet Stellar, apuntado al pool de Sobre. Una vez completado, el spike `spike-gasless.mjs` puede correr contra `http://localhost:8080`.

**Fuente oficial:** https://docs.openzeppelin.com/relayer/1.5.x  
**Ejemplo de referencia:** https://github.com/OpenZeppelin/openzeppelin-relayer/tree/main/examples/channels-plugin-example

---

## Prerequisitos

| Dependencia | Versión mínima | Verificar |
|---|---|---|
| Docker + Docker Compose | 24+ | `docker --version` |
| Redis | 7+ (o imagen Docker) | `redis-cli ping` o usar el compose del ejemplo |
| Node.js | 18+ | `node --version` |
| Cuenta Stellar testnet con XLM | 2 cuentas (fund + channel) | ver §Fondeo |

---

## Paso 1 — Clonar el OZ Relayer y el ejemplo

```bash
git clone https://github.com/OpenZeppelin/openzeppelin-relayer.git
cd openzeppelin-relayer
```

El ejemplo `examples/channels-plugin-example` trae un `docker-compose.yml` completo con Redis y el relayer preconfigurado. Es el camino más rápido.

```bash
cd examples/channels-plugin-example
```

---

## Paso 2 — Fondear las cuentas testnet (Friendbot)

Necesitás dos cuentas Stellar testnet:

1. **Fund account** (`channels-fund`): paga los fee-bumps. Necesita XLM. El empleado de Sobre NUNCA necesita XLM — la cuenta fund lo paga por él.
2. **Channel account** (`channel-001`): fuente de las transacciones (sequence number). También necesita XLM para existir.

Creá keypairs:

```bash
node -e "
const { Keypair } = require('@stellar/stellar-sdk')
const fund = Keypair.random()
const ch1 = Keypair.random()
console.log('FUND_PUB:', fund.publicKey())
console.log('FUND_SEC:', fund.secret())
console.log('CH1_PUB:', ch1.publicKey())
console.log('CH1_SEC:', ch1.secret())
"
```

Fondealas con Friendbot (testnet):

```bash
curl "https://friendbot.stellar.org?addr=<FUND_PUB>"
curl "https://friendbot.stellar.org?addr=<CH1_PUB>"
```

Verificar balance:

```bash
curl "https://horizon-testnet.stellar.org/accounts/<FUND_PUB>" | python3 -c "import sys,json; d=json.load(sys.stdin); print([b for b in d['balances'] if b['asset_type']=='native'])"
```

---

## Paso 3 — config.json del relayer

Crear `config/config.json` en el directorio del relayer (el ejemplo lo trae; ajustar IDs y red):

```json
{
  "relayers": [
    {
      "id": "channels-fund",
      "name": "Sobre Fund Account",
      "network": "testnet",
      "paused": false,
      "network_type": "stellar",
      "signer_id": "channels-fund-signer",
      "policies": {
        "concurrent_transactions": true
      }
    },
    {
      "id": "channel-001",
      "name": "Sobre Channel Account 001",
      "network": "testnet",
      "paused": false,
      "network_type": "stellar",
      "signer_id": "channel-001-signer"
    }
  ],
  "notifications": [],
  "signers": [
    {
      "id": "channels-fund-signer",
      "type": "local",
      "config": {
        "path": "config/keys/channels-fund.json",
        "passphrase": {
          "type": "env",
          "value": "KEYSTORE_PASSPHRASE_FUND"
        }
      }
    },
    {
      "id": "channel-001-signer",
      "type": "local",
      "config": {
        "path": "config/keys/channel-001.json",
        "passphrase": {
          "type": "env",
          "value": "KEYSTORE_PASSPHRASE_CHANNEL_001"
        }
      }
    }
  ],
  "networks": "./config/networks",
  "plugins": [
    {
      "id": "channels",
      "path": "channels/index.ts",
      "timeout": 30,
      "emit_logs": true,
      "emit_traces": true
    }
  ]
}
```

Los archivos de keystore (`config/keys/*.json`) los genera el CLI del relayer o la herramienta `oz-relayer-cli key create`. Ver la documentación oficial para el formato exacto del keystore cifrado.

---

## Paso 4 — .env del relayer

Crear `.env` en el directorio del relayer:

```bash
# Red
STELLAR_NETWORK=testnet

# Plugin Channels
FUND_RELAYER_ID=channels-fund
PLUGIN_ADMIN_SECRET=sobre-admin-secret-local   # solo para la management API

# Passphrases de los keystores (elegí las tuyas)
KEYSTORE_PASSPHRASE_FUND=sobre-fund-passphrase
KEYSTORE_PASSPHRASE_CHANNEL_001=sobre-ch1-passphrase

# API key que el spike va a usar (elegí la tuya)
# Nota: el OZ Relayer usa Bearer token para auth; el Channels plugin usa x-api-key.
# El relayer autentica Bearer; el plugin recibe el header x-api-key del cliente.
# Para el spike, RELAYER_API_KEY = el Bearer token configurado en el relayer.
API_KEY=sobre-spike-api-key-local

# Redis (si usás Docker Compose del ejemplo, esto ya está configurado)
REDIS_URL=redis://localhost:6379

# Límite de fee opcional (en stroops; 0 = sin límite)
# FEE_LIMIT=10000000
```

---

## Paso 5 — Levantar con Docker Compose

Desde el directorio del ejemplo:

```bash
docker compose up -d
```

Verificar que levantó:

```bash
curl http://localhost:8080/api/v1/health
# Esperado: {"status":"ok"} o similar
```

---

## Paso 6 — Inicializar las channel accounts

El plugin necesita saber qué relayer IDs son los channel accounts. Llamar a la management API:

```bash
curl -X POST http://localhost:8080/api/v1/plugins/channels/call \
  -H "Authorization: Bearer sobre-spike-api-key-local" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "management": {
        "action": "setChannelAccounts",
        "adminSecret": "sobre-admin-secret-local",
        "relayerIds": ["channel-001"]
      }
    }
  }'
# Esperado: {"success":true,"data":{"ok":true,"appliedRelayerIds":["channel-001"]}}
```

Verificar que quedó configurado:

```bash
curl -X POST http://localhost:8080/api/v1/plugins/channels/call \
  -H "Authorization: Bearer sobre-spike-api-key-local" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "management": {
        "action": "listChannelAccounts",
        "adminSecret": "sobre-admin-secret-local"
      }
    }
  }'
```

---

## Paso 7 — Correr el spike

```bash
RELAYER_URL=http://localhost:8080 \
RELAYER_API_KEY=sobre-spike-api-key-local \
  node sobrecito/apps/web/scripts/spike-gasless.mjs
```

El spike imprime un bloque JSON de resultados y una línea final:

- `GO: relayer aceptó pool.transact...` — desbloquea planes 08-02 y 08-03.
- `Plan-B: ...` — ver la descripción del trigger para el siguiente paso.

---

## Alternativa: servicio managed de OZ (sin infra local)

Si no querés levantar infraestructura local, el servicio managed de OZ tiene un endpoint de generación de key self-serve para testnet:

```bash
curl https://channels.openzeppelin.com/testnet/gen
# Devuelve: {"apiKey":"..."}
```

Luego:

```bash
RELAYER_URL=https://channels.openzeppelin.com/testnet \
RELAYER_API_KEY=<key-del-gen> \
  node sobrecito/apps/web/scripts/spike-gasless.mjs
```

En modo managed, el spike omite `pluginId` en el `ChannelsClient` (el script lo detecta automáticamente por la URL). No necesitás Docker ni Redis.

---

## Variables de entorno del spike

| Variable | Default | Descripción |
|---|---|---|
| `RELAYER_URL` | `http://localhost:8080` | URL base del relayer o del servicio managed |
| `RELAYER_API_KEY` | (requerida) | API key / Bearer token para autenticar contra el relayer |

---

## Troubleshooting

| Error del spike | Causa probable | Fix |
|---|---|---|
| `ECONNREFUSED` / `PluginTransportError` sin código | Relayer no está corriendo | `docker compose up -d`; verificar `curl http://localhost:8080/api/v1/health` |
| `401 Unauthorized` | API key incorrecta | Verificar que `RELAYER_API_KEY` coincide con `API_KEY` en el `.env` del relayer |
| `NO_CHANNELS_CONFIGURED` | Paso 6 no completado | Correr el `setChannelAccounts` del Paso 6 |
| `SIMULATION_FAILED` | Pool contract rechaza proof ZK dummy en simulación | Limitación esperada del spike; evaluar si generar un proof real o usar el smoke test contract del ejemplo oficial |
| `AUTH_EXPIRY_TOO_SHORT` | Buffer de signatureExpirationLedger muy corto | El spike usa +200 ledgers; si el relayer exige más, ajustar `MIN_SIGNATURE_EXPIRATION_LEDGER_BUFFER` en el `.env` |
| `ONCHAIN_FAILED` | Auth entry inválida on-chain | Revisar la construcción del auth entry (Approach B) o probar Approach A con `authorizeEntry` del SDK |
