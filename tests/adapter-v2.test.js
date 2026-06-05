import test from 'brittle'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildV2 } from '../src/adapters/jupiter-v2.js'
import { COMPUTE_BUDGET_PROGRAM, DEFAULT_SLIPPAGE_BPS } from '../src/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v2-build.json'), 'utf8'))

const PARAMS = {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  amount: '100000000',
  taker: 'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp',
  slippageBps: 50
}

// Brittle has no built-in mocking. We replace jest's `global.fetch` mock + `jest.spyOn`
// with a hand-rolled fetch stub that records every call, plus an AbortSignal.timeout spy.
// `setup(t)` stands in for jest's beforeEach and registers restore via t.teardown.
function makeResponse (body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

function setup (t, handler) {
  const calls = []
  const origFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push([url, init])
    return handler(String(url), init)
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

// Default handler: every fetch returns the v2 /build fixture (ok 200).
function okFixture () {
  return (t) => setup(t, () => makeResponse(fixture))
}

test('buildV2 — returns the shared internal { instructions, lookupTables, quote } shape', async (t) => {
  okFixture()(t)
  const out = await buildV2(PARAMS, {})
  t.ok('instructions' in out)
  t.ok('lookupTables' in out)
  t.ok('quote' in out)
})

test('buildV2 — prepends a SetComputeUnitLimit instruction (first ix = ComputeBudget, discriminator 2)', async (t) => {
  okFixture()(t)
  const { instructions } = await buildV2(PARAMS, { computeUnitLimit: 1_400_000 })
  const first = instructions[0]
  t.is(first.programId, COMPUTE_BUDGET_PROGRAM)
  t.is([...Buffer.from(first.data, 'base64')][0], 2)
  // exactly one extra instruction vs the fixture's ungrouped count
  const ungrouped = [
    ...fixture.computeBudgetInstructions,
    ...fixture.setupInstructions,
    fixture.swapInstruction,
    ...(fixture.cleanupInstruction ? [fixture.cleanupInstruction] : []),
    ...fixture.otherInstructions
  ]
  t.is(instructions.length, ungrouped.length + 1)
})

test('buildV2 — ungroups in order computeBudget -> setup -> swap -> cleanup -> other', async (t) => {
  okFixture()(t)
  const { instructions } = await buildV2(PARAMS, {})
  // [0] is the prepended CU-limit; [1] is the fixture's first computeBudget (CU price)
  const afterPrepend = instructions.slice(1)
  t.is(afterPrepend[0].programId, fixture.computeBudgetInstructions[0].programId)
  // the swap instruction is the Jupiter aggregator program
  t.ok(afterPrepend.some((i) => JSON.stringify(i) === JSON.stringify(fixture.swapInstruction)))
  const swapIdx = afterPrepend.findIndex((i) => i === fixture.swapInstruction)
  const setupCount = fixture.computeBudgetInstructions.length + fixture.setupInstructions.length
  t.is(swapIdx, setupCount)
})

test('buildV2 — lookupTables === addressesByLookupTableAddress (inlined, no RPC)', async (t) => {
  okFixture()(t)
  const { lookupTables } = await buildV2(PARAMS, {})
  t.alike(lookupTables, fixture.addressesByLookupTableAddress)
  t.ok(Object.keys(lookupTables).length > 0)
})

test('buildV2 — parses quote.inAmount / outAmount from the embedded quote', async (t) => {
  okFixture()(t)
  const { quote } = await buildV2(PARAMS, {})
  t.is(quote.inAmount, fixture.inAmount)
  t.is(quote.outAmount, fixture.outAmount)
  t.is(quote.swapMode, fixture.swapMode)
  t.alike(quote.routePlan, fixture.routePlan)
})

test('buildV2 — sends x-api-key header iff jupiterApiKey is set', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(PARAMS, { jupiterApiKey: 'secret-key' })
  const [, init] = calls[0]
  t.is(init.headers['x-api-key'], 'secret-key')
})

test('buildV2 — omits x-api-key header when no jupiterApiKey', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(PARAMS, {})
  const [url, init] = calls[0]
  t.is(init.headers['x-api-key'], undefined)
  // keyless default -> lite host
  t.ok(String(url).includes('lite-api.jup.ag'))
})

test('buildV2 — uses the keyed host when an API key is set', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(PARAMS, { jupiterApiKey: 'k' })
  const [url] = calls[0]
  t.ok(String(url).includes('api.jup.ag/swap/v2/build'))
  t.absent(String(url).includes('lite-api'))
})

test('buildV2 — throws on non-ok response', async (t) => {
  setup(t, () => makeResponse('bad request', { ok: false, status: 400 }))
  await t.exception(async () => { await buildV2(PARAMS, {}) }, /Jupiter v2 \/build failed: 400/)
})

test('buildV2 — passes an AbortSignal timeout to fetch (default 15000ms)', async (t) => {
  const { calls, timeoutCalls } = setup(t, () => makeResponse(fixture))
  await buildV2(PARAMS, {})
  t.ok(timeoutCalls.includes(15000))
  const [, init] = calls[0]
  t.ok(init.signal instanceof AbortSignal)
})

test('buildV2 — honors a custom timeoutMs', async (t) => {
  const { timeoutCalls } = setup(t, () => makeResponse(fixture))
  await buildV2(PARAMS, { timeoutMs: 1234 })
  t.ok(timeoutCalls.includes(1234))
})

test('buildV2 — sets computeUnitPricePercentile (cfg) and destinationTokenAccount (params) in the query', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(
    { ...PARAMS, destinationTokenAccount: 'DestTokenAcct1111111111111111111111111111111' },
    { computeUnitPricePercentile: 25 }
  )
  const [url] = calls[0]
  t.ok(String(url).includes('computeUnitPricePercentile=25'))
  t.ok(String(url).includes('destinationTokenAccount=DestTokenAcct1111111111111111111111111111111'))
})

test('buildV2 — applies route-shaping (dexes array + onlyDirectRoutes) to the query', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(PARAMS, { dexes: ['Whirlpool', 'Raydium'], onlyDirectRoutes: true })
  const [url] = calls[0]
  t.ok(String(url).includes('dexes=Whirlpool%2CRaydium'))
  t.ok(String(url).includes('onlyDirectRoutes=true'))
})

test('buildV2 — an explicit jupiterBaseUrl overrides host selection', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(PARAMS, { jupiterBaseUrl: 'https://my.proxy.example' })
  const [url] = calls[0]
  t.ok(String(url).includes('https://my.proxy.example/swap/v2/build'))
})

test('buildV2 — slippageBps falls back to cfg.slippageBps when params omits it', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(
    { inputMint: PARAMS.inputMint, outputMint: PARAMS.outputMint, amount: PARAMS.amount, taker: PARAMS.taker },
    { slippageBps: 99 }
  )
  t.ok(String(calls[0][0]).includes('slippageBps=99'))
})

test('buildV2 — slippageBps falls back to the default when neither params nor cfg set it', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(
    { inputMint: PARAMS.inputMint, outputMint: PARAMS.outputMint, amount: PARAMS.amount, taker: PARAMS.taker },
    {}
  )
  t.ok(String(calls[0][0]).includes(`slippageBps=${DEFAULT_SLIPPAGE_BPS}`))
})

test('buildV2 — accepts dexes as a plain string (not just an array)', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  await buildV2(PARAMS, { dexes: 'Whirlpool' })
  t.ok(String(calls[0][0]).includes('dexes=Whirlpool'))
})

test('buildV2 — tolerates a response that omits the optional instruction groups + ALTs', async (t) => {
  const minimal = { swapInstruction: { programId: 'Jup6', accounts: [], data: 'Ag==' }, inAmount: '1', outAmount: '2', swapMode: 'ExactIn' }
  setup(t, () => makeResponse(minimal))
  const out = await buildV2(PARAMS, {})
  // only the prepended CU-limit + the lone swap instruction survive .filter(Boolean)
  t.is(out.instructions.length, 2)
  t.alike(out.instructions[1], minimal.swapInstruction)
  t.alike(out.lookupTables, {})
})

test('buildV2 — defaults cfg to {} when called with no config arg (default-param branch)', async (t) => {
  const { calls } = setup(t, () => makeResponse(fixture))
  const out = await buildV2(PARAMS)
  t.ok('instructions' in out)
  // keyless default -> lite host
  t.ok(String(calls[0][0]).includes('lite-api.jup.ag'))
})
