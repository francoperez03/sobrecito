import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

/**
 * Scanner for the pool's `NewCommitmentEvent` (PROOF-04, auditor side).
 *
 * The pool emits one `NewCommitmentEvent` per output note (pool.rs:642). Each
 * event carries:
 *   - topic:  [symbol("new_commitment"), commitment: U256]
 *   - value:  { index: u32, encrypted_output: Bytes }
 *
 * This scanner reads those events over a ledger range with the Soroban RPC
 * `getEvents`, filters by the pool contract id, and returns decoded
 * `ScannedEvent`s. XDR decoding is delegated to `scValToNative`; no hand-rolled
 * XDR parsing (RESEARCH "Don't Hand-Roll").
 *
 * Note on RPC retention (T-05-13): a Soroban RPC node only keeps recent events
 * (a bounded ledger window). If the deployment ledger is older than the window,
 * `getEvents` rejects the range; the auditor must use an archival/indexer source
 * or re-emit. This is documented, not mitigated in v1.
 */

export interface ScanOptions {
  rpcUrl: string;
  poolContractId: string;
  fromLedger: number;
  toLedger?: number;
}

export interface ScannedEvent {
  /** Commitment hash (from the event topic). */
  commitment: bigint;
  /** Leaf index in the Merkle tree. */
  index: number;
  /** Opaque dual blob emitted verbatim by the pool (employee + auditor cts). */
  encryptedOutput: Uint8Array;
  /** Ledger sequence the event was emitted at. */
  ledger: number;
  /** Transaction hash of the payroll batch (display, audit-trail identity, block-explorer links). */
  txHash: string;
}

/**
 * Topic symbol the `#[contractevent] NewCommitmentEvent` macro emits.
 *
 * Confirmed against the live pool (deploy 04-03): the macro derives the topic
 * from the full struct name in snake_case, so it is `new_commitment_event` (NOT
 * the shorter `new_commitment`). Verified by scanning the deployed pool's event
 * histogram on testnet.
 */
const NEW_COMMITMENT_TOPIC = "new_commitment_event";

/**
 * Scan `NewCommitmentEvent`s emitted by the pool over `[fromLedger, toLedger]`.
 *
 * Paginates through the RPC cursor until the range is exhausted, parses each
 * matching event into a `ScannedEvent`, and returns them in ledger order.
 */
export async function scanCommitmentEvents(
  opts: ScanOptions,
): Promise<ScannedEvent[]> {
  const server = new Server(opts.rpcUrl, {
    allowHttp: opts.rpcUrl.startsWith("http://"),
  });

  const results: ScannedEvent[] = [];
  let cursor: string | undefined;

  // First page is opened by ledger range; subsequent pages by cursor.
  for (;;) {
    const request = cursor
      ? {
          filters: [eventFilter(opts.poolContractId)],
          cursor,
          limit: 100,
        }
      : {
          filters: [eventFilter(opts.poolContractId)],
          startLedger: opts.fromLedger,
          ...(opts.toLedger !== undefined ? { endLedger: opts.toLedger } : {}),
          limit: 100,
        };

    // The two request shapes are mutually exclusive in the SDK's discriminated
    // union; the cast keeps both branches assignable without widening the type.
    const page = await server.getEvents(
      request as Parameters<Server["getEvents"]>[0],
    );

    for (const event of page.events) {
      const parsed = parseCommitmentEvent(event);
      if (parsed !== null) {
        results.push(parsed);
      }
    }

    if (page.events.length === 0 || !page.cursor) {
      break;
    }
    cursor = page.cursor;
  }

  return results;
}

/** Build the contract event filter for the pool's commitment topic. */
function eventFilter(poolContractId: string) {
  return {
    type: "contract" as const,
    contractIds: [poolContractId],
    // First topic segment is the event name symbol; "*" wildcards the rest.
    topics: [[scValToSymbolXdr(NEW_COMMITMENT_TOPIC), "*"]],
  };
}

/**
 * Topic symbol the `#[contractevent] NewNullifierEvent` macro emits.
 *
 * Mirrors NEW_COMMITMENT_TOPIC: the macro derives the topic from the full struct
 * name in snake_case, so `NewNullifierEvent` -> `new_nullifier_event`. The
 * nullifier itself is the second topic segment (it is `#[topic]` in pool.rs);
 * there is no data value.
 */
const NEW_NULLIFIER_TOPIC = "new_nullifier_event";

/** Build the contract event filter for the pool's spent-nullifier topic. */
function nullifierEventFilter(poolContractId: string) {
  return {
    type: "contract" as const,
    contractIds: [poolContractId],
    topics: [[scValToSymbolXdr(NEW_NULLIFIER_TOPIC), "*"]],
  };
}

/**
 * Scan the pool's `NewNullifierEvent`s and return the set of spent nullifiers
 * (decimal strings) over `[fromLedger, toLedger]`.
 *
 * The employee dashboard uses this to mark already-claimed notes: `pool.is_spent`
 * is a PRIVATE contract fn (not invocable via simulate), so the spent set is read
 * from the event log instead. A nullifier present here was burned by a prior
 * `transact`, i.e. the note was claimed.
 */
export async function scanSpentNullifiers(
  opts: ScanOptions,
): Promise<Set<string>> {
  const server = new Server(opts.rpcUrl, {
    allowHttp: opts.rpcUrl.startsWith("http://"),
  });

  const spent = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const request = cursor
      ? {
          filters: [nullifierEventFilter(opts.poolContractId)],
          cursor,
          limit: 100,
        }
      : {
          filters: [nullifierEventFilter(opts.poolContractId)],
          startLedger: opts.fromLedger,
          ...(opts.toLedger !== undefined ? { endLedger: opts.toLedger } : {}),
          limit: 100,
        };

    const page = await server.getEvents(
      request as Parameters<Server["getEvents"]>[0],
    );

    for (const event of page.events) {
      const nullifier = parseNullifierEvent(event);
      if (nullifier !== null) {
        spent.add(nullifier.toString());
      }
    }

    if (page.events.length === 0 || !page.cursor) {
      break;
    }
    cursor = page.cursor;
  }

  return spent;
}

/**
 * Parse one RPC event into a spent nullifier bigint, or `null` when it is not a
 * `NewNullifierEvent` (defensive against topic/shape drift).
 */
function parseNullifierEvent(event: {
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  ledger: number;
  txHash: string;
}): bigint | null {
  const topics = event.topic;
  if (topics.length < 2) {
    return null;
  }

  const eventName = topics[0]?.switch().name === "scvSymbol"
    ? topics[0].sym().toString()
    : null;
  if (eventName !== NEW_NULLIFIER_TOPIC) {
    return null;
  }

  // topic[1] = nullifier U256.
  return toBigInt(scValToNative(topics[1]));
}

/**
 * Parse one RPC event into a `ScannedEvent`, or `null` when it is not a
 * `NewCommitmentEvent` (defensive against topic/shape drift).
 */
function parseCommitmentEvent(event: {
  topic: xdr.ScVal[];
  value: xdr.ScVal;
  ledger: number;
  txHash: string;
}): ScannedEvent | null {
  const topics = event.topic;
  if (topics.length < 2) {
    return null;
  }

  // topic[0] = symbol("new_commitment"); topic[1] = commitment U256.
  const eventName = topics[0]?.switch().name === "scvSymbol"
    ? topics[0].sym().toString()
    : null;
  if (eventName !== NEW_COMMITMENT_TOPIC) {
    return null;
  }

  const commitment = toBigInt(scValToNative(topics[1]));

  // Data value is a struct/map { index, encrypted_output }.
  const data = scValToNative(event.value) as Record<string, unknown>;
  const index = Number(data.index);
  const encryptedOutput = toUint8Array(data.encrypted_output);

  return {
    commitment,
    index,
    encryptedOutput,
    ledger: event.ledger,
    txHash: event.txHash,
  };
}

/** Encode a symbol topic to base64 XDR for the RPC topic filter. */
function scValToSymbolXdr(symbol: string): string {
  return xdr.ScVal.scvSymbol(symbol).toXDR("base64");
}

/** Coerce a `scValToNative` result (bigint | number | string) to bigint. */
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  throw new Error(
    `eventScanner: cannot coerce commitment value of type ${typeof value} to bigint`,
  );
}

/** Coerce a `scValToNative` Bytes result to `Uint8Array`. */
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error(
    "eventScanner: encrypted_output did not decode to bytes",
  );
}
