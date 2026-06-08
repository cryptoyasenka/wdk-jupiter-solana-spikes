import test from 'brittle'
import { AccountRole } from '@solana/instructions'

import { deriveAta, createAtaIdempotentIx } from '../src/ata.js'

// Classic-SPL Associated Token Account program.
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
// Classic-SPL Token program (the token program the ATA is derived under).
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

const OWNER = 'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
// Known-good vector: ATA of OWNER for the USDC mint under the classic SPL token program.
// Derived once via the same @solana-program/token helper and hardcoded here, so this test
// pins both determinism and correct wiring (owner/tokenProgram/mint seeds in the right order).
const OWNER_USDC_ATA = '2e1Vt9hWBLrqmeN9QPuthPzXhTTXyzYganhS6e5fVgqT'

test('deriveAta — returns the known-good classic-SPL ATA for a fixed (owner, mint)', async (t) => {
  const ata = await deriveAta(OWNER, USDC)
  t.is(ata, OWNER_USDC_ATA)
  t.is(typeof ata, 'string')
})

test('deriveAta — is deterministic (same inputs -> same ATA)', async (t) => {
  const a = await deriveAta(OWNER, USDC)
  const b = await deriveAta(OWNER, USDC)
  t.is(a, b)
})

test('createAtaIdempotentIx — builds a kit-shaped ATA-program instruction', (t) => {
  const ix = createAtaIdempotentIx({ payer: OWNER, ata: OWNER_USDC_ATA, owner: OWNER, mint: USDC })
  t.is(ix.programAddress, ATA_PROGRAM)
  // kit shape: data is a Uint8Array (discriminator 1 = CreateAssociatedTokenIdempotent).
  t.ok(ix.data instanceof Uint8Array)
  t.alike([...ix.data], [1])
})

test('createAtaIdempotentIx — account metas map payer/ata/owner/mint in order', (t) => {
  const ix = createAtaIdempotentIx({ payer: OWNER, ata: OWNER_USDC_ATA, owner: OWNER, mint: USDC })
  t.is(ix.accounts.length, 6)
  // payer is writable (the wallet upgrades it to the fee-payer signer at compile time).
  t.is(ix.accounts[0].address, OWNER)
  t.is(ix.accounts[0].role, AccountRole.WRITABLE)
  t.is(ix.accounts[1].address, OWNER_USDC_ATA)
  t.is(ix.accounts[1].role, AccountRole.WRITABLE)
  t.is(ix.accounts[2].address, OWNER)
  t.is(ix.accounts[2].role, AccountRole.READONLY)
  t.is(ix.accounts[3].address, USDC)
  t.is(ix.accounts[3].role, AccountRole.READONLY)
  // defaults: system program then the classic SPL token program.
  t.is(ix.accounts[4].address, '11111111111111111111111111111111')
  t.is(ix.accounts[5].address, TOKEN_PROGRAM)
})
