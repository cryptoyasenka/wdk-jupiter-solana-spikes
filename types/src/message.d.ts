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
export function buildSwapMessage(kitInstructions: Array<any>, lookupTables?: Record<string, string[]>): import("@solana/transaction-messages").TransactionMessage;
