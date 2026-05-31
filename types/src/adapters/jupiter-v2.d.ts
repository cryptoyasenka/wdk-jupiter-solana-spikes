/**
 * Build a swap via Jupiter Swap API v2 `/build` (DEFAULT path — Metis-only, no Jupiter fees,
 * single GET that returns quote + raw instructions + inlined ALTs).
 *
 * Ungroups the instructions in the canonical order computeBudget -> setup -> swap ->
 * cleanup -> other, then PREPENDS a `SetComputeUnitLimit` instruction (v2 omits it; it
 * returns only the CU-price instruction). ALTs come back already inlined as
 * `addressesByLookupTableAddress`, so NO RPC fetch is needed. `blockhashWithMetadata` is
 * ignored — the wallet sets the transaction lifetime itself.
 *
 * @param {Object} params
 * @param {string} params.inputMint
 * @param {string} params.outputMint
 * @param {string|number|bigint} params.amount - amount in the input token's base unit.
 * @param {string} params.taker - the wallet address (signer / fee-payer base).
 * @param {number} [params.slippageBps]
 * @param {string} [params.destinationTokenAccount] - SPL token account for the output (from `to`).
 * @param {Object} cfg - the protocol config (`jupiterBaseUrl`, `jupiterApiKey`, `computeUnitLimit`, `computeUnitPricePercentile`).
 * @returns {Promise<{ instructions: JupiterInstruction[], lookupTables: Record<string, string[]>, quote: Object }>}
 */
export function buildV2(params: {
    inputMint: string;
    outputMint: string;
    amount: string | number | bigint;
    taker: string;
    slippageBps?: number;
    destinationTokenAccount?: string;
}, cfg?: any): Promise<{
    instructions: JupiterInstruction[];
    lookupTables: Record<string, string[]>;
    quote: any;
}>;
export type JupiterInstruction = import("../instructions.js").JupiterInstruction;
