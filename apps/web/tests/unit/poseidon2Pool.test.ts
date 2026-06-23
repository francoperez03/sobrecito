/**
 * poseidon2Pool.test.ts — cross-check against on-chain-verified Prover.toml vectors
 *
 * SOUNDNESS RULE (A3, non-negotiable): these vectors are from the 09-04 on-chain-verified
 * witness (tx 6a83f967). The expected values are HARDCODED LITERALS — never read from
 * Prover.toml dynamically. If a vector mismatch occurs, the JS port is wrong; fix the
 * perm schedule or a constant. Do NOT weaken assertions.
 *
 * Pinned decimals from Prover.toml (confirmed verbatim):
 *   in_private_key=5, in_blinding=42, in_amount=0, out_pub_key[i]=7, out_blinding[i]=100+i
 */

import { describe, it, expect } from 'vitest'
import {
  hash3WithSep,
  hash1WithSep,
  compress,
  ZERO_LEAF,
} from '@/lib/zk/poseidon2Pool'

const BN254_P = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617')

function mod(x: bigint): bigint {
  return ((x % BN254_P) + BN254_P) % BN254_P
}

describe('poseidon2Pool – output commitments (Prover.toml vectors)', () => {
  // out_pub_key[i]=7, out_blinding[i]=100+i, out_amount[i]=0
  // commitment_i = hash3WithSep(0n, 7n, 100n+i, 1n)
  const EXPECTED_COMMITMENTS = [
    BigInt('5229152078784151807472328887896265311281808399033364372814471869899988004871'),
    BigInt('4408013700870017091298218794302325282532561314124325247358720672589825298641'),
    BigInt('4802779306905717218348282506347492460260198540731445459754900861771437959383'),
    BigInt('6035736194619245228257410820491253234417823389280420309838937263235946247572'),
    BigInt('10823252851985601283877498116419188225876413579785941004498168646371653891584'),
    BigInt('3835767255752957501685544933377423580759393791083392616852349154129209733319'),
    BigInt('11371724001293892539516969605840886680963858151785571643180275986575445616951'),
    BigInt('8543561335981316129377382884589507416841592684162776569850425554728175124404'),
  ]

  for (let i = 0; i < 8; i++) {
    const idx = i
    it(`output_commitment_${idx} matches Prover.toml`, () => {
      const result = hash3WithSep(BigInt(0), BigInt(7), BigInt(100) + BigInt(idx), BigInt(1))
      expect(result).toBe(EXPECTED_COMMITMENTS[idx])
    })
  }
})

describe('poseidon2Pool – keypair + nullifier chain (Prover.toml vectors)', () => {
  it('nullifier chain matches input_nullifier = 17540796094016619695186207484084590326080291941308026732214951827401819841709', () => {
    // in_private_key=5, in_blinding=42, in_amount=0
    const pub_key = hash1WithSep(BigInt(5), BigInt(3))
    const in_commitment = hash3WithSep(BigInt(0), pub_key, BigInt(42), BigInt(1))
    const sig = hash3WithSep(BigInt(5), in_commitment, BigInt(0), BigInt(4))
    const nullifier = hash3WithSep(in_commitment, BigInt(0), sig, BigInt(2))
    expect(nullifier).toBe(BigInt('17540796094016619695186207484084590326080291941308026732214951827401819841709'))
  })
})

describe('poseidon2Pool – empty-tree root (depth 10)', () => {
  it('empty depth-10 root matches Prover.toml root = 2302223575749844940221218608817648865122641281382153518325924961250440546344', () => {
    // Build the zero-hash chain: z0=ZERO_LEAF, z_k=compress(z_{k-1}, z_{k-1})
    let z = ZERO_LEAF
    for (let k = 0; k < 10; k++) {
      z = compress(z, z)
    }
    expect(z).toBe(BigInt('2302223575749844940221218608817648865122641281382153518325924961250440546344'))
  })
})

describe('poseidon2Pool – ZERO_LEAF constant', () => {
  it('ZERO_LEAF decimal equals 16820622405745174042249830601237189755928192602553897283642901160942722677198', () => {
    expect(ZERO_LEAF).toBe(BigInt('16820622405745174042249830601237189755928192602553897283642901160942722677198'))
  })

  it('ZERO_LEAF hex equals 0x25302288db99350344974183ce310d63b53abb9ef0f8575753eed36e0118f9ce', () => {
    expect('0x' + ZERO_LEAF.toString(16)).toBe('0x25302288db99350344974183ce310d63b53abb9ef0f8575753eed36e0118f9ce')
  })
})
