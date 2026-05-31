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

import { address } from '@solana/addresses'
import { AccountRole } from '@solana/instructions'

import { COMPUTE_BUDGET_PROGRAM } from './constants.js'

/**
 * @typedef {Object} JupiterAccountMeta
 * @property {string} pubkey - base58 account address.
 * @property {boolean} isSigner - whether the account signs the transaction.
 * @property {boolean} isWritable - whether the account is written to.
 */
/**
 * @typedef {Object} JupiterInstruction
 * @property {string} programId - base58 program address.
 * @property {JupiterAccountMeta[]} accounts - the instruction's account metas.
 * @property {string} data - base64-encoded instruction data.
 */

/**
 * Map a Jupiter `AccountMeta` (`isSigner`/`isWritable` booleans) to a kit `AccountRole`.
 * Lifted verbatim from the Phase-0 spike (proven against live mainnet).
 *
 * @param {JupiterAccountMeta} m
 * @returns {AccountRole}
 */
export function toRole (m) {
  if (m.isSigner && m.isWritable) return AccountRole.WRITABLE_SIGNER
  if (m.isSigner) return AccountRole.READONLY_SIGNER
  if (m.isWritable) return AccountRole.WRITABLE
  return AccountRole.READONLY
}

/**
 * Map a raw Jupiter instruction (v1 `/swap-instructions` or v2 `/build`, identical shape)
 * to a `@solana/transaction-messages` instruction. Lifted verbatim from the Phase-0 spike.
 *
 * @param {JupiterInstruction} ix
 * @returns {{ programAddress: import('@solana/addresses').Address, accounts: Array<{ address: import('@solana/addresses').Address, role: AccountRole }>, data: Uint8Array }}
 */
export function toKitInstruction (ix) {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((m) => ({ address: address(m.pubkey), role: toRole(m) })),
    data: new Uint8Array(Buffer.from(ix.data, 'base64'))
  }
}

/**
 * Build a raw `SetComputeUnitLimit` ComputeBudget instruction in the Jupiter wire shape
 * (so it flows through {@link toKitInstruction} unchanged). v2 `/build` returns only the
 * CU-*price* instruction (no limit), so the v2 adapter must prepend this one.
 * Encoding: discriminator `0x02` + `u32` little-endian `units`.
 *
 * @param {number} units - compute-unit limit (1..1_400_000).
 * @returns {JupiterInstruction}
 */
export function setComputeUnitLimitInstruction (units) {
  const data = Buffer.alloc(5)
  data.writeUInt8(2, 0) // SetComputeUnitLimit discriminator
  data.writeUInt32LE(units, 1)
  return { programId: COMPUTE_BUDGET_PROGRAM, accounts: [], data: data.toString('base64') }
}
