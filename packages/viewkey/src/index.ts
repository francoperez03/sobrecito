// Public API of the viewkey package.
export type {
  NotePayload,
  EncryptedBlob,
  AuditorNote,
  BatchSummary,
} from "./types.js";
export { buildExtContextHash, BN254_FIELD_MODULUS } from "./types.js";

// Crypto core: ECIES over X25519 + dual-blob encode/decode.
export { encryptNote, decryptNote } from "./crypto/ecies.js";
export {
  encodeDualBlob,
  decodeDualBlob,
  buildEncryptedOutputs,
  N_OUTS,
} from "./crypto/encoding.js";

// Event scanner: read NewCommitmentEvent from the pool over a ledger range.
export { scanCommitmentEvents, scanSpentNullifiers } from "./scanner/eventScanner.js";
export type { ScanOptions, ScannedEvent } from "./scanner/eventScanner.js";

// Auditor-side reconstruction: scan events → decrypt → reconcile against T.
export { reconstructBatch } from "./reconstructor/batchReconstructor.js";
export type {
  ReconstructOptions,
  EventSource,
} from "./reconstructor/batchReconstructor.js";

// Auditor keygen: user-facing X25519 keypair generation + base64 (de)serialization.
export {
  generateAuditorKeypair,
  keyToBase64,
  keyFromBase64,
} from "./crypto/keygen.js";
export type { AuditorKeypair } from "./crypto/keygen.js";
