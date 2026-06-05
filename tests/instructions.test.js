import test from 'brittle'
import { AccountRole } from '@solana/instructions'

import { toRole, toKitInstruction, setComputeUnitLimitInstruction } from '../src/instructions.js'
import { COMPUTE_BUDGET_PROGRAM } from '../src/constants.js'

test('toRole — signer + writable -> WRITABLE_SIGNER', (t) => {
  t.is(toRole({ isSigner: true, isWritable: true }), AccountRole.WRITABLE_SIGNER)
})
test('toRole — signer + read-only -> READONLY_SIGNER', (t) => {
  t.is(toRole({ isSigner: true, isWritable: false }), AccountRole.READONLY_SIGNER)
})
test('toRole — non-signer + writable -> WRITABLE', (t) => {
  t.is(toRole({ isSigner: false, isWritable: true }), AccountRole.WRITABLE)
})
test('toRole — non-signer + read-only -> READONLY', (t) => {
  t.is(toRole({ isSigner: false, isWritable: false }), AccountRole.READONLY)
})

test('toKitInstruction — maps a Jupiter instruction to a kit instruction', (t) => {
  const ix = {
    programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    accounts: [
      { pubkey: 'So11111111111111111111111111111111111111112', isSigner: true, isWritable: true },
      { pubkey: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', isSigner: false, isWritable: false }
    ],
    data: Buffer.from([1, 2, 3, 4]).toString('base64')
  }
  const kit = toKitInstruction(ix)
  t.is(kit.programAddress, 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
  t.is(kit.accounts.length, 2)
  t.alike(kit.accounts[0], {
    address: 'So11111111111111111111111111111111111111112',
    role: AccountRole.WRITABLE_SIGNER
  })
  t.is(kit.accounts[1].role, AccountRole.READONLY)
  t.ok(kit.data instanceof Uint8Array)
  t.alike([...kit.data], [1, 2, 3, 4])
})

test('setComputeUnitLimitInstruction — builds a ComputeBudget SetComputeUnitLimit instruction (discriminator 2 + u32 LE)', (t) => {
  const ix = setComputeUnitLimitInstruction(1_400_000)
  t.is(ix.programId, COMPUTE_BUDGET_PROGRAM)
  t.alike(ix.accounts, [])
  const bytes = [...Buffer.from(ix.data, 'base64')]
  t.is(bytes[0], 2) // SetComputeUnitLimit discriminator
  // u32 LE of 1_400_000
  const view = new DataView(new Uint8Array(bytes.slice(1)).buffer)
  t.is(view.getUint32(0, true), 1_400_000)
  t.is(bytes.length, 5)
})

test('setComputeUnitLimitInstruction — encodes an arbitrary unit count as little-endian', (t) => {
  const ix = setComputeUnitLimitInstruction(300_000)
  const bytes = [...Buffer.from(ix.data, 'base64')]
  const view = new DataView(new Uint8Array(bytes.slice(1)).buffer)
  t.is(view.getUint32(0, true), 300_000)
})
