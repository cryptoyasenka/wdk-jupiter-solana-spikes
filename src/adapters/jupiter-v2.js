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

import { JUPITER_HOSTS, DEFAULT_SLIPPAGE_BPS, DEFAULT_COMPUTE_UNIT_LIMIT } from '../constants.js'
import { setComputeUnitLimitInstruction } from '../instructions.js'

/** @typedef {import('../instructions.js').JupiterInstruction} JupiterInstruction */

/**
 * Pick the Jupiter base URL: an explicit override wins; otherwise the keyed host when an
 * API key is present, else the keyless lite host.
 *
 * @param {Object} cfg
 * @returns {string}
 */
function resolveBaseUrl (cfg) {
  if (cfg.jupiterBaseUrl) return cfg.jupiterBaseUrl
  return cfg.jupiterApiKey ? JUPITER_HOSTS.keyed : JUPITER_HOSTS.lite
}

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
export async function buildV2 (params, cfg = {}) {
  const base = resolveBaseUrl(cfg)
  const slippageBps = params.slippageBps ?? cfg.slippageBps ?? DEFAULT_SLIPPAGE_BPS

  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    taker: params.taker,
    slippageBps: String(slippageBps)
  })
  if (cfg.computeUnitPricePercentile !== undefined) {
    query.set('computeUnitPricePercentile', String(cfg.computeUnitPricePercentile))
  }
  if (params.destinationTokenAccount) {
    query.set('destinationTokenAccount', params.destinationTokenAccount)
  }

  const headers = {}
  if (cfg.jupiterApiKey) headers['x-api-key'] = cfg.jupiterApiKey

  const res = await fetch(`${base}/swap/v2/build?${query.toString()}`, { headers })
  if (!res.ok) {
    throw new Error(`Jupiter v2 /build failed: ${res.status} ${await res.text()}`)
  }
  const resp = await res.json()

  const ungrouped = [
    ...(resp.computeBudgetInstructions || []),
    ...(resp.setupInstructions || []),
    resp.swapInstruction,
    ...(resp.cleanupInstruction ? [resp.cleanupInstruction] : []),
    ...(resp.otherInstructions || [])
  ].filter(Boolean)

  // v2 returns only the CU-price instruction; prepend the CU-limit ourselves.
  const cuLimit = setComputeUnitLimitInstruction(cfg.computeUnitLimit ?? DEFAULT_COMPUTE_UNIT_LIMIT)
  const instructions = [cuLimit, ...ungrouped]

  return {
    instructions,
    lookupTables: resp.addressesByLookupTableAddress || {},
    quote: {
      inputMint: resp.inputMint,
      outputMint: resp.outputMint,
      inAmount: resp.inAmount,
      outAmount: resp.outAmount,
      otherAmountThreshold: resp.otherAmountThreshold,
      swapMode: resp.swapMode,
      slippageBps: resp.slippageBps,
      routePlan: resp.routePlan
    }
  }
}
