/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapProtocolConfig} SwapProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapOptions} SwapOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapResult} SwapResult */
/**
 * @typedef {SwapProtocolConfig & Object} JupiterProtocolConfig
 * @property {number | bigint} [swapMaxFee] - max fee (lamports) for a swap; the only field from the WDK contract.
 * @property {number} [slippageBps=50] - slippage tolerance in basis points (Jupiter-specific, additive).
 * @property {'v2' | 'v1'} [apiVersion='v2'] - default adapter. v2 `/build` (ExactIn). BUY auto-routes to v1 ExactOut.
 * @property {string} [jupiterBaseUrl] - override the Jupiter host (defaults: keyless lite, or keyed when a key is set).
 * @property {string} [jupiterApiKey] - API key for the keyed host. ENV-ONLY; never hardcode (e.g. `process.env.JUPITER_API_KEY`).
 * @property {number} [computeUnitLimit=1400000] - CU limit prepended on v2 (`/build` omits it).
 * @property {number | string} [computeUnitPricePercentile] - v2 priority-fee control ('medium'/'high'/'veryHigh' or 0-10000 bps).
 */
/**
 * Lets a `@tetherto/wdk-wallet-solana` account swap SPL tokens through the Jupiter aggregator.
 * The Solana peer of `@tetherto/wdk-protocol-swap-velora-evm`: same `swap(options)` /
 * `quoteSwap(options)` surface, same `{ hash, fee, tokenInAmount, tokenOutAmount }` returns.
 *
 * Default path is Jupiter Swap API v2 `/build` (Metis-only, no Jupiter fees, ExactIn).
 * BUY (`tokenOutAmount`) auto-routes through v1 `swapMode=ExactOut` (v2 `/build` is
 * ExactIn-only). The built `TransactionMessage` carries only the compressed instruction
 * list — the wallet sets fee payer + lifetime + signs.
 *
 * @augments SwapProtocol
 */
export default class JupiterProtocolSolana extends SwapProtocol {
    /**
     * @param {import('@tetherto/wdk-wallet-solana').WalletAccountReadOnlySolana | import('@tetherto/wdk-wallet-solana').WalletAccountSolana} account
     * @param {JupiterProtocolConfig} [config]
     */
    constructor(account: import("@tetherto/wdk-wallet-solana").WalletAccountReadOnlySolana | import("@tetherto/wdk-wallet-solana").WalletAccountSolana, config?: JupiterProtocolConfig);
    /**
     * Resolve the RPC client used for v1 ALT fetches: reuse the account's live RPC when
     * present (same endpoint we broadcast through), else build one from its provider URL.
     *
     * @private
     * @returns {import('@solana/rpc').Rpc<any>}
     */
    private _getRpc;
    /**
     * Build the swap `TransactionMessage` + the quoted in/out amounts via the configured
     * adapter. SELL (`tokenInAmount`) -> v2 `/build` ExactIn by default (v1 if `apiVersion:'v1'`).
     * BUY (`tokenOutAmount`) -> v1 `swapMode=ExactOut` (v2 `/build` is ExactIn-only, so BUY
     * always routes to v1 regardless of `apiVersion`).
     *
     * `to` (optional): passed through to Jupiter as `destinationTokenAccount`. NOTE: Jupiter
     * expects a token ACCOUNT address here, not the owner's wallet address. ATA derivation
     * from an owner address is a documented Medium enhancement (would add `@solana-program/token`)
     * — not done here; pass `to` as the recipient's SPL token account for `tokenOut`.
     *
     * @private
     * @param {SwapOptions} options
     * @returns {Promise<{ message: import('@solana/transaction-messages').TransactionMessage, tokenInAmount: bigint, tokenOutAmount: bigint }>}
     */
    private _getSwapMessage;
}
export type SwapProtocolConfig = import("@tetherto/wdk-wallet/protocols").SwapProtocolConfig;
export type SwapOptions = import("@tetherto/wdk-wallet/protocols").SwapOptions;
export type SwapResult = import("@tetherto/wdk-wallet/protocols").SwapResult;
export type JupiterProtocolConfig = SwapProtocolConfig & any;
import { SwapProtocol } from '@tetherto/wdk-wallet/protocols';
