import test from 'brittle'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { WalletAccountSolana, WalletAccountReadOnlySolana } from '@tetherto/wdk-wallet-solana'

import JupiterProtocolSolana from '../index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const v2Fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v2-build.json'), 'utf8'))
const v1Quote = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v1-quote.json'), 'utf8'))
const v1Ix = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v1-swap-instructions.json'), 'utf8'))
// v1 swap-instructions with no lookup tables, so the real buildV1 ALT loop never runs
// (lets us route BUY through real v1 without supplying a working ALT rpc).
const v1IxNoAlt = { ...v1Ix, addressLookupTableAddresses: [] }

const WSOL = 'So11111111111111111111111111111111111111112'
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const TAKER = 'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp'
const SELL_OPTIONS = { tokenIn: WSOL, tokenOut: USDT, tokenInAmount: 100_000_000n }
const BUY_OPTIONS = { tokenIn: WSOL, tokenOut: USDT, tokenOutAmount: 100_000_000n }

// --- Replacing jest's module mocks (wallet + adapters + message).
// Brittle has no module mocking, so instead of mocking the adapters we drive the REAL
// buildV2 / buildV1 / buildSwapMessage through a stubbed globalThis.fetch, and instead of
// a mock wallet class we use Object.create(<real class>.prototype) so the production
// `instanceof WalletAccountSolana` guard sees the genuine prototype chain. Wallet I/O
// methods (getAddress / quote / send) are stubbed on the instance (instance stubbing, not
// module mocking) — exactly what the jest version did, minus the network.

function makeResponse (body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

// Records the calls each stubbed wallet method receives.
function recorder (ret) {
  const calls = []
  const fn = async (...args) => { calls.push(args); return typeof ret === 'function' ? ret(...args) : ret }
  fn.calls = calls
  return fn
}

// Build a real-prototype account (instanceof-true) with stubbed wallet I/O.
function makeAccount ({ Class = WalletAccountSolana, provider = 'https://rpc.example', fee = 5000n } = {}) {
  const account = Object.create(Class.prototype)
  account._config = { provider }
  account.getAddress = recorder(TAKER)
  account.quoteSendTransaction = recorder({ fee })
  account.sendTransaction = recorder({ hash: 'sig-123', fee })
  account.getTokenBalance = recorder(0n)
  return account
}

// Stubs globalThis.fetch + records every call + AbortSignal.timeout; restores via teardown.
// `route` decides, by URL, which fixture to return — this is how we observe which Jupiter
// API version the protocol chose (v2 /build vs v1 /quote+/swap-instructions) without a spy.
function setup (t, { sell = v2Fixture, buyQuote = v1Quote, buyIx = v1IxNoAlt } = {}) {
  const calls = []
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    calls.push([u, init])
    if (u.includes('/swap/v2/build')) return makeResponse(sell)
    if (u.includes('/swap/v1/quote')) return makeResponse(buyQuote)
    if (u.includes('/swap/v1/swap-instructions')) return makeResponse(buyIx)
    throw new Error(`unexpected fetch ${u}`)
  }
  const origTimeout = AbortSignal.timeout.bind(AbortSignal)
  AbortSignal.timeout = (ms) => origTimeout(ms)
  t.teardown(() => { globalThis.fetch = origFetch; AbortSignal.timeout = origTimeout })

  return {
    calls,
    hitV2: () => calls.some(([u]) => u.includes('/swap/v2/build')),
    hitV1: () => calls.some(([u]) => u.includes('/swap/v1/quote')),
    v2Url: () => calls.find(([u]) => u.includes('/swap/v2/build'))?.[0],
    v1QuoteUrl: () => calls.find(([u]) => u.includes('/swap/v1/quote'))?.[0],
    v1IxBody: () => {
      const c = calls.find(([u]) => u.includes('/swap/v1/swap-instructions'))
      return c ? JSON.parse(c[1].body) : undefined
    }
  }
}

// --- quoteSwap (SELL) ---

test('quoteSwap (SELL) — returns the 3 canonical bigint fields', async (t) => {
  setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, {})
  const out = await protocol.quoteSwap(SELL_OPTIONS)
  t.alike(out, { fee: 5000n, tokenInAmount: 100000000n, tokenOutAmount: 8231846n })
  t.is(typeof out.fee, 'bigint')
  t.is(typeof out.tokenInAmount, 'bigint')
  t.is(typeof out.tokenOutAmount, 'bigint')
})

test('quoteSwap (SELL) — routes to v2 by default and passes the built message to quoteSendTransaction', async (t) => {
  const net = setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, {})
  await protocol.quoteSwap(SELL_OPTIONS)
  t.ok(net.hitV2())
  t.absent(net.hitV1())
  // the real built v0 message reached the account
  t.is(account.quoteSendTransaction.calls.length, 1)
  const msg = account.quoteSendTransaction.calls[0][0]
  t.is(msg.version, 0)
  t.ok(Array.isArray(msg.instructions))
})

test('quoteSwap (SELL) — throws the verbatim provider string when no provider', async (t) => {
  setup(t)
  const account = makeAccount()
  account._config = {} // no provider
  const protocol = new JupiterProtocolSolana(account, {})
  await t.exception(
    async () => { await protocol.quoteSwap(SELL_OPTIONS) },
    /The wallet must be connected to a provider in order to quote swap operations\./
  )
})

// --- swap (SELL) ---

test('swap (SELL) — returns the 4 canonical fields incl. hash', async (t) => {
  setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, {})
  const out = await protocol.swap(SELL_OPTIONS)
  t.alike(out, { hash: 'sig-123', fee: 5000n, tokenInAmount: 100000000n, tokenOutAmount: 8231846n })
})

test('swap (SELL) — passes the SAME built message to quote+send (no feePayer/lifetime)', async (t) => {
  setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, {})
  await protocol.swap(SELL_OPTIONS)
  const quotedMsg = account.quoteSendTransaction.calls[0][0]
  const sentMsg = account.sendTransaction.calls[0][0]
  t.is(quotedMsg, sentMsg) // identical object instance
  t.ok('instructions' in sentMsg)
  t.is(sentMsg.feePayer, undefined)
  t.is(sentMsg.lifetimeConstraint, undefined)
})

test('swap (SELL) — fee-exceeded throws the VERBATIM fee string and never sends', async (t) => {
  setup(t)
  const account = makeAccount({ fee: 10_000n })
  const protocol = new JupiterProtocolSolana(account, { swapMaxFee: 9_999n })
  await t.exception(
    async () => { await protocol.swap(SELL_OPTIONS) },
    /Exceeded maximum fee cost for swap operation\./
  )
  t.is(account.sendTransaction.calls.length, 0)
})

test('swap (SELL) — does not throw when fee is below swapMaxFee', async (t) => {
  setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, { swapMaxFee: 1_000_000n })
  const out = await protocol.swap(SELL_OPTIONS)
  t.is(out.hash, 'sig-123')
})

test('swap (SELL) — read-only account throws the VERBATIM read-only string', async (t) => {
  setup(t)
  const account = makeAccount({ Class: WalletAccountReadOnlySolana })
  const protocol = new JupiterProtocolSolana(account, {})
  await t.exception(
    async () => { await protocol.swap(SELL_OPTIONS) },
    /The 'swap\(options\)' method requires the protocol to be initialized with a non read-only account\./
  )
})

test('swap (SELL) — no provider throws the VERBATIM provider string', async (t) => {
  setup(t)
  const account = makeAccount()
  account._config = {}
  const protocol = new JupiterProtocolSolana(account, {})
  await t.exception(
    async () => { await protocol.swap(SELL_OPTIONS) },
    /The wallet must be connected to a provider in order to perform swap operations\./
  )
})

// --- BUY (ExactOut) routes to v1 ---

test('BUY — always uses v1 with swapMode=ExactOut, even with default (v2) config', async (t) => {
  const net = setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, {})
  const out = await protocol.quoteSwap(BUY_OPTIONS)
  t.ok(net.hitV1())
  t.absent(net.hitV2())
  // swapMode=ExactOut + the BUY amount both surface in the real outgoing v1 /quote query
  t.ok(net.v1QuoteUrl().includes('swapMode=ExactOut'))
  t.ok(net.v1QuoteUrl().includes('amount=100000000'))
  // amounts come from the real v1 /quote fixture (in 100000000 / out 8308221)
  t.is(out.tokenInAmount, BigInt(v1Quote.inAmount))
  t.is(out.tokenOutAmount, BigInt(v1Quote.outAmount))
  t.is(typeof out.tokenOutAmount, 'bigint')
})

// --- _getSwapMessage param mapping ---

test('mapping — SELL maps tokenIn/tokenOut/amount/taker + slippage into the v2 request', async (t) => {
  const net = setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, { slippageBps: 75 })
  await protocol.quoteSwap(SELL_OPTIONS)
  const url = net.v2Url()
  t.ok(url.includes(`inputMint=${WSOL}`))
  t.ok(url.includes(`outputMint=${USDT}`))
  t.ok(url.includes('amount=100000000'))
  t.ok(url.includes(`taker=${TAKER}`))
  t.ok(url.includes('slippageBps=75'))
})

test('mapping — passes `to` through as destinationTokenAccount', async (t) => {
  const net = setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, {})
  await protocol.quoteSwap({ ...SELL_OPTIONS, to: 'DestTokenAcct1111111111111111111111111111111' })
  t.ok(net.v2Url().includes('destinationTokenAccount=DestTokenAcct1111111111111111111111111111111'))
})

test('mapping — throws when neither tokenInAmount nor tokenOutAmount is provided', async (t) => {
  setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, {})
  await t.exception(
    async () => { await protocol.quoteSwap({ tokenIn: WSOL, tokenOut: USDT }) },
    /A swap requires either tokenInAmount \(SELL\) or tokenOutAmount \(BUY\)\./
  )
})

test('mapping — throws when BOTH amounts are provided (no adapter call)', async (t) => {
  const net = setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account, {})
  await t.exception(
    async () => { await protocol.quoteSwap({ ...SELL_OPTIONS, tokenOutAmount: 8_231_846n }) },
    /A swap requires exactly one of tokenInAmount \(SELL\) or tokenOutAmount \(BUY\), not both\./
  )
  t.absent(net.hitV2())
  t.absent(net.hitV1())
})

// --- SELL routes to v1 when apiVersion=v1 ---

test('apiVersion v1 — sends SELL (ExactIn) through v1, not v2, with no swapMode', async (t) => {
  const net = setup(t)
  const account = makeAccount()
  account._rpc = { /* present but ALTs are empty so it is never used */ }
  const protocol = new JupiterProtocolSolana(account, { apiVersion: 'v1' })
  await protocol.quoteSwap(SELL_OPTIONS)
  t.ok(net.hitV1())
  t.absent(net.hitV2())
  t.ok(net.v1QuoteUrl().includes('amount=100000000'))
  t.absent(net.v1QuoteUrl().includes('swapMode='))
})

// --- _getRpc resolution + default config ---

test('config — constructs with no config arg (config defaults to {})', async (t) => {
  const net = setup(t)
  const account = makeAccount()
  const protocol = new JupiterProtocolSolana(account)
  const out = await protocol.quoteSwap(SELL_OPTIONS)
  t.ok(net.hitV2())
  t.is(out.tokenInAmount, 100000000n)
})

test('_getRpc — reuses the account live _rpc for v1 ALT fetches when present', async (t) => {
  setup(t)
  const account = makeAccount()
  const sentinelRpc = { _sentinel: 'live-rpc' }
  account._rpc = sentinelRpc
  const protocol = new JupiterProtocolSolana(account, {})
  // BUY -> v1; with empty ALTs the rpc is never network-called, but _getRpc still resolves it
  await protocol.quoteSwap(BUY_OPTIONS)
  // assert the resolution path directly (this is exactly the value injected as buildV1's 3rd arg)
  t.is(protocol._getRpc(), sentinelRpc)
})

test('_getRpc — builds an RPC from the first provider when the provider is an array', async (t) => {
  setup(t)
  const account = makeAccount({ provider: ['https://rpc-a.example', 'https://rpc-b.example'] })
  // no live _rpc -> _getRpc builds one from provider[0]
  const protocol = new JupiterProtocolSolana(account, {})
  await protocol.quoteSwap(BUY_OPTIONS) // BUY -> v1, exercises the build-from-provider path
  const rpc = protocol._getRpc()
  t.ok(rpc !== undefined && rpc !== null)
})
