/** Wrapped SOL mint (native SOL is auto-wrapped by Jupiter when `wrapAndUnwrapSol`). */
export const WSOL_MINT: "So11111111111111111111111111111111111111112";
/** USDT mint on Solana mainnet (used by the Phase-0 spikes + e2e). */
export const USDT_MINT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export namespace JUPITER_HOSTS {
    let lite: string;
    let keyed: string;
}
/** ComputeBudget program address (for the manual SetComputeUnitLimit instruction on v2). */
export const COMPUTE_BUDGET_PROGRAM: "ComputeBudget111111111111111111111111111111";
/** Default slippage tolerance in basis points (matches the WDK family default). */
export const DEFAULT_SLIPPAGE_BPS: 50;
/** Default compute-unit limit prepended on v2 (`/build` omits the CU-limit instruction). */
export const DEFAULT_COMPUTE_UNIT_LIMIT: 1400000;
