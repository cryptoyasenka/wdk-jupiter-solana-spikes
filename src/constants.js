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

/** Wrapped SOL mint (native SOL is auto-wrapped by Jupiter when `wrapAndUnwrapSol`). */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'

/** USDT mint on Solana mainnet (used by the Phase-0 spikes + e2e). */
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

/**
 * Jupiter Swap API hosts.
 * `lite` is keyless / free (rate-limited); `keyed` requires an `x-api-key`.
 * Empirically confirmed (2026-05-31): `lite-api.jup.ag/swap/v2/build` responds 200 keyless,
 * so v2 `/build` (the default) runs key-free on the lite host. The keyed host is used only
 * when `jupiterApiKey` is supplied.
 */
export const JUPITER_HOSTS = {
  lite: 'https://lite-api.jup.ag',
  keyed: 'https://api.jup.ag'
}

/** ComputeBudget program address (for the manual SetComputeUnitLimit instruction on v2). */
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111'

/** Default slippage tolerance in basis points (matches the WDK family default). */
export const DEFAULT_SLIPPAGE_BPS = 50

/** Default compute-unit limit prepended on v2 (`/build` omits the CU-limit instruction). */
export const DEFAULT_COMPUTE_UNIT_LIMIT = 1_400_000

/** Default per-request timeout (ms) for Jupiter HTTP calls, so a hung host can't stall a swap. */
export const DEFAULT_TIMEOUT_MS = 15_000
