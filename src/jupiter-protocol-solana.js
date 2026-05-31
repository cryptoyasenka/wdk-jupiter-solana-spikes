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

import { SwapProtocol } from '@tetherto/wdk-wallet/protocols'
import { WalletAccountSolana } from '@tetherto/wdk-wallet-solana'
import { createSolanaRpc } from '@solana/rpc'

import { buildV2 } from './adapters/jupiter-v2.js'
import { buildV1 } from './adapters/jupiter-v1.js'
import { toKitInstruction } from './instructions.js'
import { buildSwapMessage } from './message.js'

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
 * @property {string | string[]} [dexes] - Jupiter-native route shaping: restrict routing to these DEX labels (e.g. `'Whirlpool'` or `['Whirlpool','Raydium']`).
 * @property {boolean} [onlyDirectRoutes] - Jupiter-native route shaping: force a single-hop route (no intermediate tokens).
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
  constructor (account, config = {}) {
    super(account, config) // sets this._account, this._config
  }

  /**
   * Quote a swap without sending it.
   *
   * @param {SwapOptions} options
   * @returns {Promise<Omit<SwapResult, 'hash'>>} `{ fee, tokenInAmount, tokenOutAmount }` (all bigint).
   */
  async quoteSwap (options) {
    if (!this._account?._config?.provider) {
      throw new Error('The wallet must be connected to a provider in order to quote swap operations.')
    }
    const { message, tokenInAmount, tokenOutAmount } = await this._getSwapMessage(options)
    const { fee } = await this._account.quoteSendTransaction(message)
    return { fee, tokenInAmount, tokenOutAmount }
  }

  /**
   * Build, fee-guard, and send a swap transaction.
   *
   * @param {SwapOptions} options
   * @returns {Promise<SwapResult>} `{ hash, fee, tokenInAmount, tokenOutAmount }`.
   */
  async swap (options) {
    if (!(this._account instanceof WalletAccountSolana)) {
      throw new Error("The 'swap(options)' method requires the protocol to be initialized with a non read-only account.")
    }
    if (!this._account?._config?.provider) {
      throw new Error('The wallet must be connected to a provider in order to perform swap operations.')
    }
    const { message, tokenInAmount, tokenOutAmount } = await this._getSwapMessage(options)
    const { fee } = await this._account.quoteSendTransaction(message)
    if (this._config.swapMaxFee !== undefined && fee >= this._config.swapMaxFee) {
      throw new Error('Exceeded maximum fee cost for swap operation.')
    }
    const { hash } = await this._account.sendTransaction(message)
    return { hash, fee, tokenInAmount, tokenOutAmount }
  }

  /**
   * Resolve the RPC client used for v1 ALT fetches: reuse the account's live RPC when
   * present (same endpoint we broadcast through), else build one from its provider URL.
   *
   * @private
   * @returns {import('@solana/rpc').Rpc<any>}
   */
  _getRpc () {
    if (this._account?._rpc) return this._account._rpc
    const provider = this._account?._config?.provider
    const url = Array.isArray(provider) ? provider[0] : provider
    return createSolanaRpc(url)
  }

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
  async _getSwapMessage (options) {
    const { tokenIn, tokenOut, tokenInAmount, tokenOutAmount, to } = options
    const taker = await this._account.getAddress()

    const params = {
      inputMint: tokenIn,
      outputMint: tokenOut,
      taker,
      slippageBps: this._config.slippageBps,
      destinationTokenAccount: to
    }

    let adapter
    if (tokenInAmount !== undefined && tokenInAmount !== null) {
      // SELL — ExactIn. v2 by default; v1 when configured.
      params.amount = tokenInAmount
      adapter = (this._config.apiVersion === 'v1')
        ? (p, c) => buildV1(p, c, this._getRpc())
        : buildV2
    } else if (tokenOutAmount !== undefined && tokenOutAmount !== null) {
      // BUY — ExactOut. Only v1 supports it; always route to v1.
      params.amount = tokenOutAmount
      params.swapMode = 'ExactOut'
      adapter = (p, c) => buildV1(p, c, this._getRpc())
    } else {
      throw new Error('A swap requires either tokenInAmount (SELL) or tokenOutAmount (BUY).')
    }

    const { instructions, lookupTables, quote } = await adapter(params, this._config)
    const message = buildSwapMessage(instructions.map(toKitInstruction), lookupTables)
    return {
      message,
      tokenInAmount: BigInt(quote.inAmount),
      tokenOutAmount: BigInt(quote.outAmount)
    }
  }
}
