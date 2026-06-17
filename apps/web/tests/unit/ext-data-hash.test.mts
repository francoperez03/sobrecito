import { describe, it, expect } from 'vitest'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { xdr, Address, XdrLargeInt } from '@stellar/stellar-sdk'

// Mirror of hashExtDataSobre (RESEARCH Pattern 3). Soroban #[contracttype]
// structs serialize as an ScMap ordered alphabetically by field name:
// encrypted_outputs -> ext_amount -> recipient. The hash is
// keccak256(xdr) mod BN254, big-endian. Must match the contract's hash_ext_data.
const BN254_MOD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

function hashExtDataSobre(params: {
  recipient: string
  ext_amount: bigint
  encrypted_outputs: Uint8Array[]
}): string {
  const entries = [
    {
      key: 'encrypted_outputs',
      val: xdr.ScVal.scvVec(
        params.encrypted_outputs.map((b) => xdr.ScVal.scvBytes(Buffer.from(b))),
      ),
    },
    {
      key: 'ext_amount',
      val: new XdrLargeInt('i256', params.ext_amount.toString()).toScVal(),
    },
    { key: 'recipient', val: Address.fromString(params.recipient).toScVal() },
  ]
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const scEntries = entries.map(
    (e) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(e.key), val: e.val }),
  )
  const digest = keccak_256(xdr.ScVal.scvMap(scEntries).toXDR())
  let big = 0n
  for (const byte of digest) big = (big << 8n) | BigInt(byte)
  return (big % BN254_MOD).toString(16).padStart(64, '0')
}

describe('hashExtDataSobre (ext_data_hash, Pattern 3)', () => {
  it('matches the contract reference for the demo fixture (mikey, ext_amount=0, 8 empty blobs)', () => {
    const hex = hashExtDataSobre({
      recipient: 'GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW',
      ext_amount: 0n,
      encrypted_outputs: Array.from({ length: 8 }, () => new Uint8Array(0)),
    })
    expect(hex).toBe(
      '0b3f2759b68a3bf239da2b7d987c95c9373c5595623ae21d334f01c123c66056',
    )
    expect(hex.startsWith('0b3f2759')).toBe(true)
  })

  it('is sensitive to ext_amount (different amount yields a different hash)', () => {
    const base = {
      recipient: 'GBWJZZ3XSNAY3WLFNLXUZXEEYMZCYVG4TW6Z5VSASJS2TOWF7GGPPKMW',
      encrypted_outputs: Array.from({ length: 8 }, () => new Uint8Array(0)),
    }
    const a = hashExtDataSobre({ ...base, ext_amount: 0n })
    const b = hashExtDataSobre({ ...base, ext_amount: 1n })
    expect(a).not.toBe(b)
  })
})
