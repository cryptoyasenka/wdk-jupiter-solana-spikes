// Copyright 2026 cryptoyasenka
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict'

import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS
} from '@solana-program/token'

/**
 * Derive an owner's Associated Token Account (ATA) for a mint under the classic SPL
 * Token program. Pure PDA derivation — no RPC. NOTE: classic SPL only; Token-2022 mints
 * (owned by `TOKEN_2022_PROGRAM_ADDRESS`) would derive under a different token program,
 * which can't be detected without an on-chain account read — out of scope here.
 *
 * @param {import('@solana/addresses').Address} owner - owner wallet address.
 * @param {import('@solana/addresses').Address} mint - token mint.
 * @returns {Promise<import('@solana/addresses').Address>} the derived classic-SPL ATA.
 */
export async function deriveAta (owner, mint) {
  const [ata] = await findAssociatedTokenPda({ owner, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint })
  return ata
}

/**
 * Build a `createAssociatedTokenAccountIdempotent` instruction (already kit-shaped — it goes
 * straight into the kit instruction list, NOT through `toKitInstruction`). Idempotent: a no-op
 * if `ata` already exists. The `payer` funds the account's ~0.002 SOL rent. Classic SPL only
 * (the instruction defaults `tokenProgram` to `TOKEN_PROGRAM_ADDRESS`).
 *
 * @param {object} params
 * @param {import('@solana/addresses').Address} params.payer - rent payer (the swap taker / fee payer).
 * @param {import('@solana/addresses').Address} params.ata - the ATA to create (from {@link deriveAta}).
 * @param {import('@solana/addresses').Address} params.owner - owner wallet address.
 * @param {import('@solana/addresses').Address} params.mint - token mint.
 * @returns {{ programAddress: import('@solana/addresses').Address, accounts: Array<{ address: import('@solana/addresses').Address, role: number }>, data: Uint8Array }}
 */
export function createAtaIdempotentIx ({ payer, ata, owner, mint }) {
  return getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner, mint })
}
