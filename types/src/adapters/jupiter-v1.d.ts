/**
 * Build a swap via Jupiter Swap API v1 (FALLBACK path, and the only path that supports
 * BUY / `swapMode=ExactOut`). Two calls: GET `/quote` then POST `/swap-instructions`.
 *
 * Ungroups the instructions in the same canonical order as v2. Does NOT prepend a
 * `SetComputeUnitLimit` — v1 emits its own CU-limit via `dynamicComputeUnitLimit:true`.
 * v1 returns only `addressLookupTableAddresses` (a list of table addresses), so each ALT's
 * contents are fetched from the RPC via `fetchAddressLookupTable`.
 *
 * @param {Object} params
 * @param {string} params.inputMint
 * @param {string} params.outputMint
 * @param {string|number|bigint} params.amount
 * @param {string} params.taker
 * @param {number} [params.slippageBps]
 * @param {'ExactIn'|'ExactOut'} [params.swapMode]
 * @param {string} [params.destinationTokenAccount]
 * @param {Object} cfg
 * @param {import('@solana/rpc').Rpc<any>} rpc - the account's RPC client (for ALT fetches).
 * @returns {Promise<{ instructions: JupiterInstruction[], lookupTables: Record<string, string[]>, quote: Object }>}
 */
export function buildV1(params: {
    inputMint: string;
    outputMint: string;
    amount: string | number | bigint;
    taker: string;
    slippageBps?: number;
    swapMode?: "ExactIn" | "ExactOut";
    destinationTokenAccount?: string;
}, cfg: any, rpc: import("@solana/rpc").Rpc<any>): Promise<{
    instructions: JupiterInstruction[];
    lookupTables: Record<string, string[]>;
    quote: any;
}>;
export type JupiterInstruction = import("../instructions.js").JupiterInstruction;
