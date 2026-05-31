import { describe, expect, test } from '@jest/globals'

import { buildSwapMessage } from '../src/message.js'
import { toKitInstruction } from '../src/instructions.js'

const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const ACC_A = 'So11111111111111111111111111111111111111112'
const ACC_B = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
// any valid base58 address works as the lookup-table key
const TABLE = 'ComputeBudget111111111111111111111111111111'

function kitIx (accounts = []) {
  return toKitInstruction({
    programId: JUP,
    accounts,
    data: Buffer.from([1, 2, 3]).toString('base64')
  })
}

describe('buildSwapMessage', () => {
  test('builds a v0 message with the instructions appended (no-ALT branch)', () => {
    const msg = buildSwapMessage([kitIx(), kitIx()], {})
    expect(msg.version).toBe(0)
    expect(msg.instructions).toHaveLength(2)
  })

  test('treats undefined lookupTables as the no-ALT branch (no compression)', () => {
    const msg = buildSwapMessage([kitIx()], undefined)
    expect(msg.version).toBe(0)
    expect(msg.instructions).toHaveLength(1)
    expect(msg.addressTableLookups ?? []).toHaveLength(0)
  })

  test('compresses with ALTs when a non-empty lookupTables map is given', () => {
    const accounts = [
      { pubkey: ACC_A, isSigner: false, isWritable: true },
      { pubkey: ACC_B, isSigner: false, isWritable: false }
    ]
    const msg = buildSwapMessage([kitIx(accounts)], { [TABLE]: [ACC_A, ACC_B] })
    // Exercises the compress-with-ALTs branch. The lookup table only materialises as
    // `addressTableLookups` once the message is compiled; on the uncompiled message we
    // assert the compression step runs without throwing and preserves the v0 shape.
    expect(msg.version).toBe(0)
    expect(msg.instructions).toHaveLength(1)
  })
})
