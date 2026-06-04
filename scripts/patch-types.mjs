// Re-assert the two public override methods in the emitted declaration file.
//
// WHY: `JupiterProtocolSolana` overrides the ABSTRACT `swap` / `quoteSwap` of
// `SwapProtocol` with signatures identical to the base. TypeScript's declaration
// emit (`--emitDeclarationOnly` over JS+JSDoc) drops an override whose type is
// identical to the inherited member — but for an *abstract* base that makes the
// shipped class look like it still has unimplemented members, so strict
// downstream consumers fail to compile with TS2654 ("Non-abstract class ... is
// missing implementations for the following members ..."). We inject the
// concrete signatures back so the published surface matches the runtime class.
// The strict-consumer compile in `typecheck/` is the regression guard.
//
// Idempotent. Fails loudly (exit 1) if the constructor anchor is missing, so a
// future tsc layout change can never silently re-ship a broken declaration.

import { readFileSync, writeFileSync } from 'node:fs'

const FILE = new URL('../types/src/jupiter-protocol-solana.d.ts', import.meta.url)

const METHODS = `    /**
     * Quote a swap without sending it.
     * @param {SwapOptions} options
     * @returns {Promise<Omit<SwapResult, 'hash'>>} \`{ fee, tokenInAmount, tokenOutAmount }\` (all bigint).
     */
    quoteSwap(options: SwapOptions): Promise<Omit<SwapResult, "hash">>;
    /**
     * Build, fee-guard, and send a swap transaction.
     * @param {SwapOptions} options
     * @returns {Promise<SwapResult>} \`{ hash, fee, tokenInAmount, tokenOutAmount }\`.
     */
    swap(options: SwapOptions): Promise<SwapResult>;`

const src = readFileSync(FILE, 'utf8')

if (/\n\s*quoteSwap\(options:/.test(src)) {
  console.log('patch-types: quoteSwap/swap already present — nothing to do.')
  process.exit(0)
}

const lines = src.split('\n')

// Find the constructor declaration, then the line that ends its signature (`);`)
// so we insert directly after it — robust to the constructor wrapping across lines.
const ctorIdx = lines.findIndex(l => /^\s*constructor\(/.test(l))
if (ctorIdx === -1) {
  console.error(`patch-types: FAILED — no constructor anchor in ${FILE.pathname}.`)
  console.error('The declaration layout changed; update scripts/patch-types.mjs.')
  process.exit(1)
}
let endIdx = ctorIdx
while (endIdx < lines.length && !/\);\s*$/.test(lines[endIdx])) endIdx++
if (endIdx >= lines.length) {
  console.error(`patch-types: FAILED — could not find the end of the constructor signature in ${FILE.pathname}.`)
  process.exit(1)
}

lines.splice(endIdx + 1, 0, METHODS)
writeFileSync(FILE, lines.join('\n'))
console.log('patch-types: injected concrete quoteSwap/swap into the published .d.ts.')
