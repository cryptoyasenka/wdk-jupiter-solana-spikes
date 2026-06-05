import test from 'brittle'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getAddressLookupTableEncoder } from '@solana-program/address-lookup-table'
import { getBase64Decoder } from '@solana/kit'

import { buildV1 } from '../src/adapters/jupiter-v1.js'
import { COMPUTE_BUDGET_PROGRAM, DEFAULT_SLIPPAGE_BPS } from '../src/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const quoteFixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v1-quote.json'), 'utf8'))
const ixFixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v1-swap-instructions.json'), 'utf8'))

const PARAMS = {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  amount: '100000000',
  taker: 'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp',
  slippageBps: 50
}

// --- Replacing jest's module mock of `@solana-program/address-lookup-table`.
// Brittle has no module mocking, so instead of mocking `fetchAddressLookupTable` we drive
// the REAL function through a hand-rolled `rpc` stub (the third arg `buildV1` already
// accepts for dependency injection). The stub returns a genuine, library-encoded ALT
// account, so the real decoder reads back addresses we control — exercising the same
// per-table fetch + contents-mapping path the production code runs.
const ALT_ADDRESSES = [
  'So11111111111111111111111111111111111111112',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
]

function encodedAlt (addresses) {
  const bytes = getAddressLookupTableEncoder().encode({
    discriminator: 1,
    deactivationSlot: 18446744073709551615n,
    lastExtendedSlot: 0n,
    lastExtendedSlotStartIndex: 0,
    authority: '11111111111111111111111111111111',
    addresses
  })
  return { dataB64: getBase64Decoder().decode(bytes), len: bytes.length }
}

// A recording rpc stub: counts ALT fetches and returns a real encoded ALT for each.
function makeAltRpc () {
  const requested = []
  const { dataB64, len } = encodedAlt(ALT_ADDRESSES)
  return {
    requested,
    rpc: {
      getAccountInfo (addr) {
        requested.push(addr)
        return {
          send: async () => ({
            context: { slot: 1n },
            value: {
              data: [dataB64, 'base64'],
              executable: false,
              lamports: 1_000_000n,
              owner: 'AddressLookupTab1e1111111111111111111111111',
              rentEpoch: 0n,
              space: BigInt(len)
            }
          })
        }
      }
    }
  }
}

function makeResponse (body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

// Stands in for jest's beforeEach + global.fetch mock. `responses` is an array of
// per-call response factories: 1st call = GET /quote, 2nd = POST /swap-instructions.
// Records every fetch call and the AbortSignal.timeout calls; restores via t.teardown.
function setup (t, responses) {
  const calls = []
  let i = 0
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push([url, init])
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return r()
  }

  const origTimeout = AbortSignal.timeout.bind(AbortSignal)
  const timeoutCalls = []
  AbortSignal.timeout = (ms) => {
    timeoutCalls.push(ms)
    return origTimeout(ms)
  }

  t.teardown(() => {
    globalThis.fetch = origFetch
    AbortSignal.timeout = origTimeout
  })

  return { calls, timeoutCalls }
}

// Default: quote then swap-instructions, both ok.
function defaultResponses () {
  return [() => makeResponse(quoteFixture), () => makeResponse(ixFixture)]
}

test('buildV1 — returns the shared internal { instructions, lookupTables, quote } shape', async (t) => {
  setup(t, defaultResponses())
  const out = await buildV1(PARAMS, {}, makeAltRpc().rpc)
  t.ok('instructions' in out)
  t.ok('lookupTables' in out)
  t.ok('quote' in out)
})

test('buildV1 — does NOT prepend a SetComputeUnitLimit (v1 emits its own)', async (t) => {
  setup(t, defaultResponses())
  const { instructions } = await buildV1(PARAMS, {}, makeAltRpc().rpc)
  const ungrouped = [
    ...ixFixture.computeBudgetInstructions,
    ...ixFixture.setupInstructions,
    ixFixture.swapInstruction,
    ...(ixFixture.cleanupInstruction ? [ixFixture.cleanupInstruction] : []),
    ...ixFixture.otherInstructions
  ].filter(Boolean)
  // no extra instruction added
  t.is(instructions.length, ungrouped.length)
  // first instruction is the fixture's own first computeBudget (the CU-limit Jupiter emitted)
  t.alike(instructions[0], ixFixture.computeBudgetInstructions[0])
  t.is(instructions[0].programId, COMPUTE_BUDGET_PROGRAM)
})

test('buildV1 — ungroups in order computeBudget -> setup -> swap -> cleanup -> other', async (t) => {
  setup(t, defaultResponses())
  const { instructions } = await buildV1(PARAMS, {}, makeAltRpc().rpc)
  const swapIdx = instructions.findIndex((i) => i === ixFixture.swapInstruction)
  const before = ixFixture.computeBudgetInstructions.length + ixFixture.setupInstructions.length
  t.is(swapIdx, before)
})

test('buildV1 — fetches each ALT via fetchAddressLookupTable and builds the contents map', async (t) => {
  setup(t, defaultResponses())
  const alt = makeAltRpc()
  const { lookupTables } = await buildV1(PARAMS, {}, alt.rpc)
  t.is(alt.requested.length, ixFixture.addressLookupTableAddresses.length)
  for (const a of ixFixture.addressLookupTableAddresses) {
    t.alike(lookupTables[a], ALT_ADDRESSES)
  }
})

test('buildV1 — quote is the /quote response', async (t) => {
  setup(t, defaultResponses())
  const { quote } = await buildV1(PARAMS, {}, makeAltRpc().rpc)
  t.is(quote.inAmount, quoteFixture.inAmount)
  t.is(quote.outAmount, quoteFixture.outAmount)
})

test('buildV1 — posts quoteResponse + userPublicKey to /swap-instructions', async (t) => {
  const { calls } = setup(t, defaultResponses())
  await buildV1(PARAMS, {}, makeAltRpc().rpc)
  const [url, init] = calls[1]
  t.ok(String(url).includes('/swap/v1/swap-instructions'))
  t.is(init.method, 'POST')
  const body = JSON.parse(init.body)
  t.is(body.userPublicKey, PARAMS.taker)
  t.is(body.quoteResponse.outAmount, quoteFixture.outAmount)
  t.is(body.wrapAndUnwrapSol, true)
  t.is(body.dynamicComputeUnitLimit, true)
})

test('buildV1 — passes swapMode=ExactOut into the /quote query when set', async (t) => {
  const { calls } = setup(t, defaultResponses())
  await buildV1({ ...PARAMS, swapMode: 'ExactOut' }, {}, makeAltRpc().rpc)
  const [url] = calls[0]
  t.ok(String(url).includes('swapMode=ExactOut'))
  t.ok(String(url).includes('restrictIntermediateTokens=true'))
})

test('buildV1 — passes an AbortSignal timeout to both fetches (default 15000ms)', async (t) => {
  const { calls, timeoutCalls } = setup(t, defaultResponses())
  await buildV1(PARAMS, {}, makeAltRpc().rpc)
  t.ok(timeoutCalls.includes(15000))
  const [, init0] = calls[0]
  const [, init1] = calls[1]
  t.ok(init0.signal instanceof AbortSignal)
  t.ok(init1.signal instanceof AbortSignal)
})

test('buildV1 — throws when /quote responds non-ok', async (t) => {
  setup(t, [() => makeResponse('rate limited', { ok: false, status: 500 })])
  await t.exception(async () => { await buildV1(PARAMS, {}, makeAltRpc().rpc) }, /Jupiter v1 \/quote failed: 500/)
})

test('buildV1 — throws when /swap-instructions responds non-ok', async (t) => {
  setup(t, [() => makeResponse(quoteFixture), () => makeResponse('bad quote', { ok: false, status: 422 })])
  await t.exception(async () => { await buildV1(PARAMS, {}, makeAltRpc().rpc) }, /Jupiter v1 \/swap-instructions failed: 422/)
})

test('buildV1 — applies route-shaping + destinationTokenAccount (v1 parity with v2)', async (t) => {
  const { calls } = setup(t, defaultResponses())
  await buildV1(
    { ...PARAMS, destinationTokenAccount: 'DestTokenAcct1111111111111111111111111111111' },
    { dexes: 'Whirlpool', onlyDirectRoutes: true },
    makeAltRpc().rpc
  )
  const [quoteUrl] = calls[0]
  t.ok(String(quoteUrl).includes('dexes=Whirlpool'))
  t.ok(String(quoteUrl).includes('onlyDirectRoutes=true'))
  const [, ixInit] = calls[1]
  t.is(JSON.parse(ixInit.body).destinationTokenAccount, 'DestTokenAcct1111111111111111111111111111111')
})

test('buildV1 — an explicit jupiterBaseUrl overrides host selection (both calls)', async (t) => {
  const { calls } = setup(t, defaultResponses())
  await buildV1(PARAMS, { jupiterBaseUrl: 'https://my.proxy.example' }, makeAltRpc().rpc)
  t.ok(String(calls[0][0]).includes('https://my.proxy.example/swap/v1/quote'))
  t.ok(String(calls[1][0]).includes('https://my.proxy.example/swap/v1/swap-instructions'))
})

test('buildV1 — sends x-api-key header and uses the keyed host when jupiterApiKey is set', async (t) => {
  const { calls } = setup(t, defaultResponses())
  await buildV1(PARAMS, { jupiterApiKey: 'secret' }, makeAltRpc().rpc)
  const [url, init] = calls[0]
  t.ok(String(url).includes('api.jup.ag/swap/v1/quote'))
  t.is(init.headers['x-api-key'], 'secret')
})

test('buildV1 — slippageBps falls back to cfg.slippageBps when params omits it', async (t) => {
  const { calls } = setup(t, defaultResponses())
  await buildV1(
    { inputMint: PARAMS.inputMint, outputMint: PARAMS.outputMint, amount: PARAMS.amount, taker: PARAMS.taker },
    { slippageBps: 99 },
    makeAltRpc().rpc
  )
  t.ok(String(calls[0][0]).includes('slippageBps=99'))
})

test('buildV1 — slippageBps falls back to the default when neither params nor cfg set it', async (t) => {
  const { calls } = setup(t, defaultResponses())
  await buildV1(
    { inputMint: PARAMS.inputMint, outputMint: PARAMS.outputMint, amount: PARAMS.amount, taker: PARAMS.taker },
    {},
    makeAltRpc().rpc
  )
  t.ok(String(calls[0][0]).includes(`slippageBps=${DEFAULT_SLIPPAGE_BPS}`))
})

test('buildV1 — accepts dexes as an array (joined with commas)', async (t) => {
  const { calls } = setup(t, defaultResponses())
  await buildV1(PARAMS, { dexes: ['Whirlpool', 'Raydium'] }, makeAltRpc().rpc)
  t.ok(String(calls[0][0]).includes('dexes=Whirlpool%2CRaydium'))
})

test('buildV1 — tolerates a /swap-instructions response that omits optional groups + ALT addresses', async (t) => {
  const minimalIx = { swapInstruction: { programId: 'Jup6', accounts: [], data: 'Ag==' } }
  setup(t, [() => makeResponse(quoteFixture), () => makeResponse(minimalIx)])
  const alt = makeAltRpc()
  const out = await buildV1(PARAMS, {}, alt.rpc)
  t.alike(out.instructions, [minimalIx.swapInstruction])
  t.alike(out.lookupTables, {})
  t.is(alt.requested.length, 0)
})

test('buildV1 — defaults cfg to {} when called with cfg=undefined (default-param branch)', async (t) => {
  const { calls } = setup(t, defaultResponses())
  const out = await buildV1(PARAMS, undefined, makeAltRpc().rpc)
  t.ok('instructions' in out)
  t.ok(String(calls[0][0]).includes('/swap/v1/quote'))
})
