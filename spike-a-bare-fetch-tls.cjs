'use strict'

/**
 * SPIKE A — bare-fetch HTTPS/TLS reachability to Jupiter under the Bare runtime.
 *
 * BINARY RISK this de-risks:
 *   The whole module's value depends on talking to Jupiter's REST API from
 *   inside Bare (Holepunch's runtime — the one the WDK spec mandates support
 *   for). Node has battle-tested TLS; Bare does NOT use Node's `https`. It uses
 *   its own `bare-fetch` / `bare-tls` stack. If TLS to `lite-api.jup.ag` does
 *   not negotiate under Bare, the module is dead on arrival and we must pick a
 *   different approach BEFORE writing any module code. This is exactly the
 *   "Bare-TLS unproven" binary-risk kill-shot — we prove it empirically here.
 *
 * WHAT IT DOES:
 *   A single keyless GET to the Jupiter free-tier quote endpoint
 *   (0.1 SOL -> USDT) and prints the route summary. No keys, no wallet, no
 *   transaction — purely "can Bare reach Jupiter over TLS and parse JSON".
 *
 * HOW TO RUN:
 *   1. Install Bare:            npm i -g bare        (or: npx bare ...)
 *   2. From build/spikes/:      npm install          (installs bare-fetch)
 *   3. Run under BARE, not Node: bare spike-a-bare-fetch-tls.js
 *
 *   Running it under Node (`node spike-a-...`) PROVES NOTHING — Node's TLS is
 *   not the runtime under test. It MUST be `bare`.
 *
 * PASS  : prints an HTTP 200, an `outAmount`, and a non-empty `routePlan`.
 * FAIL  : TLS handshake error / module-not-found / no body -> Bare cannot reach
 *         Jupiter; escalate (proxy via bare-http1+bare-tls manually, or
 *         reconsider runtime support claim) before M2.
 *
 * NOTE on import shape: `bare-fetch` is a fast-moving Holepunch package. The
 * exact export (`require('bare-fetch')` returning the fetch fn vs `.default`)
 * MUST be confirmed against the version `npm install` actually pins — that
 * confirmation is part of the spike, not an assumption to carry into M2.
 */

// Holepunch's WHATWG-fetch implementation for Bare. NOT Node's global fetch.
const fetch = require('bare-fetch')

// Verified 2026-05-27: free tier = lite-api.jup.ag/swap/v1, no API key.
// Paid tier (api.jup.ag) only differs by host + key header; same paths.
const JUPITER_BASE = 'https://lite-api.jup.ag/swap/v1'

// Canonical mints (verified): wrapped SOL and USDT-SPL.
const WSOL_MINT = 'So11111111111111111111111111111111111111112'
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

const AMOUNT_LAMPORTS = '100000000' // 0.1 SOL (9 decimals)
const SLIPPAGE_BPS = '50'

async function main () {
  const url =
    `${JUPITER_BASE}/quote` +
    `?inputMint=${WSOL_MINT}` +
    `&outputMint=${USDT_MINT}` +
    `&amount=${AMOUNT_LAMPORTS}` +
    `&slippageBps=${SLIPPAGE_BPS}` +
    `&restrictIntermediateTokens=true`

  console.log('[spike-a] runtime  :', typeof Bare !== 'undefined' ? 'Bare ✓' : 'NOT Bare (results meaningless)')
  console.log('[spike-a] GET      :', url)

  const started = Date.now()
  const res = await fetch(url)
  const ms = Date.now() - started

  console.log('[spike-a] status   :', res.status, `(${ms} ms)`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`[spike-a] FAIL non-200: ${res.status} ${text}`)
  }

  const quote = await res.json()

  const ok =
    quote &&
    typeof quote.outAmount === 'string' &&
    Array.isArray(quote.routePlan) &&
    quote.routePlan.length > 0

  console.log('[spike-a] inAmount :', quote.inAmount)
  console.log('[spike-a] outAmount:', quote.outAmount, '(USDT base units, 6 dp)')
  console.log('[spike-a] priceImpactPct:', quote.priceImpactPct)
  console.log('[spike-a] routePlan hops:', quote.routePlan && quote.routePlan.length)
  console.log('[spike-a] routePlan AMMs :', (quote.routePlan || []).map(function (r) {
    return r.swapInfo && r.swapInfo.label
  }))

  if (!ok) throw new Error('[spike-a] FAIL malformed quote (no outAmount / empty routePlan)')

  console.log('\n[spike-a] PASS — Bare reached Jupiter over TLS and parsed a real route.')
}

main().catch(function (err) {
  console.error('\n[spike-a] FAIL —', err && err.stack ? err.stack : err)
  // Bare exits non-zero on uncaught; make it explicit for CI/manual runs.
  if (typeof Bare !== 'undefined') Bare.exit(1)
  else process.exit(1)
})
