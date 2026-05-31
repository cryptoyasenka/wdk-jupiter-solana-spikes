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
  createTransactionMessage,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables
} from '@solana/transaction-messages'

/**
 * Build the v0 `TransactionMessage` the WDK Solana account expects: just the compressed
 * instruction list. We deliberately do NOT set fee payer or lifetime here — the wallet's
 * `_prepareTransactionMessage` runs `_ensureLifetime` + `_assertFeePayer` +
 * `setTransactionMessageFeePayerSigner` itself on the `Array.isArray(tx.instructions)`
 * branch. Setting them here would clash with the wallet's fee-payer assertion.
 *
 * `pipe` from `@solana/functional` is intentionally NOT used (it ships on kit's v4 line,
 * not the granular 3.0.3 set the wallet runs); the transforms are nested directly.
 *
 * @param {Array<Object>} kitInstructions - instructions already mapped via `toKitInstruction`.
 * @param {Record<string, string[]>} [lookupTables] - `{ [tableAddr]: address[] }` ALT map.
 * @returns {import('@solana/transaction-messages').TransactionMessage}
 */
export function buildSwapMessage (kitInstructions, lookupTables) {
  const base = appendTransactionMessageInstructions(
    kitInstructions,
    createTransactionMessage({ version: 0 })
  )
  return Object.keys(lookupTables || {}).length
    ? compressTransactionMessageUsingAddressLookupTables(base, lookupTables)
    : base
}
