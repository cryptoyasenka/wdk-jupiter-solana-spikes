import { describe, expect, test } from '@jest/globals'
import { AccountRole } from '@solana/instructions'

import { toRole, toKitInstruction, setComputeUnitLimitInstruction } from '../src/instructions.js'
import { COMPUTE_BUDGET_PROGRAM } from '../src/constants.js'

describe('toRole', () => {
  test('signer + writable -> WRITABLE_SIGNER', () => {
    expect(toRole({ isSigner: true, isWritable: true })).toBe(AccountRole.WRITABLE_SIGNER)
  })
  test('signer + read-only -> READONLY_SIGNER', () => {
    expect(toRole({ isSigner: true, isWritable: false })).toBe(AccountRole.READONLY_SIGNER)
  })
  test('non-signer + writable -> WRITABLE', () => {
    expect(toRole({ isSigner: false, isWritable: true })).toBe(AccountRole.WRITABLE)
  })
  test('non-signer + read-only -> READONLY', () => {
    expect(toRole({ isSigner: false, isWritable: false })).toBe(AccountRole.READONLY)
  })
})

describe('toKitInstruction', () => {
  test('maps a Jupiter instruction to a kit instruction', () => {
    const ix = {
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      accounts: [
        { pubkey: 'So11111111111111111111111111111111111111112', isSigner: true, isWritable: true },
        { pubkey: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', isSigner: false, isWritable: false }
      ],
      data: Buffer.from([1, 2, 3, 4]).toString('base64')
    }
    const kit = toKitInstruction(ix)
    expect(kit.programAddress).toBe('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
    expect(kit.accounts).toHaveLength(2)
    expect(kit.accounts[0]).toEqual({
      address: 'So11111111111111111111111111111111111111112',
      role: AccountRole.WRITABLE_SIGNER
    })
    expect(kit.accounts[1].role).toBe(AccountRole.READONLY)
    expect(kit.data).toBeInstanceOf(Uint8Array)
    expect([...kit.data]).toEqual([1, 2, 3, 4])
  })
})

describe('setComputeUnitLimitInstruction', () => {
  test('builds a ComputeBudget SetComputeUnitLimit instruction (discriminator 2 + u32 LE)', () => {
    const ix = setComputeUnitLimitInstruction(1_400_000)
    expect(ix.programId).toBe(COMPUTE_BUDGET_PROGRAM)
    expect(ix.accounts).toEqual([])
    const bytes = [...Buffer.from(ix.data, 'base64')]
    expect(bytes[0]).toBe(2) // SetComputeUnitLimit discriminator
    // u32 LE of 1_400_000
    const view = new DataView(new Uint8Array(bytes.slice(1)).buffer)
    expect(view.getUint32(0, true)).toBe(1_400_000)
    expect(bytes).toHaveLength(5)
  })

  test('encodes an arbitrary unit count as little-endian', () => {
    const ix = setComputeUnitLimitInstruction(300_000)
    const bytes = [...Buffer.from(ix.data, 'base64')]
    const view = new DataView(new Uint8Array(bytes.slice(1)).buffer)
    expect(view.getUint32(0, true)).toBe(300_000)
  })
})
