// Public API of the viewkey package.
//
// Types and the ext-context-hash schema. The crypto core (ECIES + dual-blob
// encode/decode) is re-exported here once implemented in src/crypto/*.
export type {
  NotePayload,
  EncryptedBlob,
  AuditorNote,
  BatchSummary,
} from "./types.js";
export { buildExtContextHash, BN254_FIELD_MODULUS } from "./types.js";
