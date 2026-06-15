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
