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
import { fetchAddressLookupTable } from '@solana-program/address-lookup-table'

import { JUPITER_HOSTS, DEFAULT_SLIPPAGE_BPS } from '../constants.js'

/** @typedef {import('../instructions.js').JupiterInstruction} JupiterInstruction */

/**
 * Pick the Jupiter base URL (see jupiter-v2.js for the same logic).
 *
 * @param {Object} cfg
 * @returns {string}
 */
function resolveBaseUrl (cfg) {
  if (cfg.jupiterBaseUrl) return cfg.jupiterBaseUrl
  return cfg.jupiterApiKey ? JUPITER_HOSTS.keyed : JUPITER_HOSTS.lite
}

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
export async function buildV1 (params, cfg = {}, rpc) {
  const base = resolveBaseUrl(cfg)
  const slippageBps = params.slippageBps ?? cfg.slippageBps ?? DEFAULT_SLIPPAGE_BPS

  const headers = {}
  if (cfg.jupiterApiKey) headers['x-api-key'] = cfg.jupiterApiKey

  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: String(params.amount),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: 'true'
  })
  if (params.swapMode) query.set('swapMode', params.swapMode)
  // Optional route shaping (Jupiter-native): mirror v2 so the fallback honors the same config.
  if (cfg.dexes) query.set('dexes', Array.isArray(cfg.dexes) ? cfg.dexes.join(',') : String(cfg.dexes))
  if (cfg.onlyDirectRoutes) query.set('onlyDirectRoutes', 'true')

  const quoteRes = await fetch(`${base}/swap/v1/quote?${query.toString()}`, { headers })
  if (!quoteRes.ok) {
    throw new Error(`Jupiter v1 /quote failed: ${quoteRes.status} ${await quoteRes.text()}`)
  }
  const quote = await quoteRes.json()

  const body = {
    quoteResponse: quote,
    userPublicKey: params.taker,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true
  }
  if (params.destinationTokenAccount) body.destinationTokenAccount = params.destinationTokenAccount

  const ixRes = await fetch(`${base}/swap/v1/swap-instructions`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!ixRes.ok) {
    throw new Error(`Jupiter v1 /swap-instructions failed: ${ixRes.status} ${await ixRes.text()}`)
  }
  const resp = await ixRes.json()

  const instructions = [
    ...(resp.computeBudgetInstructions || []),
    ...(resp.setupInstructions || []),
    resp.swapInstruction,
    ...(resp.cleanupInstruction ? [resp.cleanupInstruction] : []),
    ...(resp.otherInstructions || [])
  ].filter(Boolean)

  // v1 returns table addresses only; fetch each table's contents from the RPC.
  const lookupTables = {}
  for (const a of resp.addressLookupTableAddresses || []) {
    const acct = await fetchAddressLookupTable(rpc, address(a))
    lookupTables[a] = acct.data.addresses
  }

  return { instructions, lookupTables, quote }
}
