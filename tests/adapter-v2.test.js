import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildV2 } from '../src/adapters/jupiter-v2.js'
import { COMPUTE_BUDGET_PROGRAM } from '../src/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v2-build.json'), 'utf8'))

const PARAMS = {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  amount: '100000000',
  taker: 'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp',
  slippageBps: 50
}

function mockFetchOk (body) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  })
}

describe('buildV2', () => {
  beforeEach(() => {
    global.fetch = mockFetchOk(fixture)
  })
  afterEach(() => {
    jest.restoreAllMocks()
    delete global.fetch
  })

  test('returns the shared internal { instructions, lookupTables, quote } shape', async () => {
    const out = await buildV2(PARAMS, {})
    expect(out).toHaveProperty('instructions')
    expect(out).toHaveProperty('lookupTables')
    expect(out).toHaveProperty('quote')
  })

  test('prepends a SetComputeUnitLimit instruction (first ix = ComputeBudget, discriminator 2)', async () => {
    const { instructions } = await buildV2(PARAMS, { computeUnitLimit: 1_400_000 })
    const first = instructions[0]
    expect(first.programId).toBe(COMPUTE_BUDGET_PROGRAM)
    expect([...Buffer.from(first.data, 'base64')][0]).toBe(2)
    // exactly one extra instruction vs the fixture's ungrouped count
    const ungrouped = [
      ...fixture.computeBudgetInstructions,
      ...fixture.setupInstructions,
      fixture.swapInstruction,
      ...(fixture.cleanupInstruction ? [fixture.cleanupInstruction] : []),
      ...fixture.otherInstructions
    ]
    expect(instructions).toHaveLength(ungrouped.length + 1)
  })

  test('ungroups in order computeBudget -> setup -> swap -> cleanup -> other', async () => {
    const { instructions } = await buildV2(PARAMS, {})
    // [0] is the prepended CU-limit; [1] is the fixture's first computeBudget (CU price)
    const afterPrepend = instructions.slice(1)
    expect(afterPrepend[0].programId).toBe(fixture.computeBudgetInstructions[0].programId)
    // the swap instruction is the Jupiter aggregator program
    expect(afterPrepend).toContainEqual(fixture.swapInstruction)
    const swapIdx = afterPrepend.findIndex((i) => i === fixture.swapInstruction)
    const setupCount = fixture.computeBudgetInstructions.length + fixture.setupInstructions.length
    expect(swapIdx).toBe(setupCount)
  })

  test('lookupTables === addressesByLookupTableAddress (inlined, no RPC)', async () => {
    const { lookupTables } = await buildV2(PARAMS, {})
    expect(lookupTables).toEqual(fixture.addressesByLookupTableAddress)
    expect(Object.keys(lookupTables).length).toBeGreaterThan(0)
  })

  test('parses quote.inAmount / outAmount from the embedded quote', async () => {
    const { quote } = await buildV2(PARAMS, {})
    expect(quote.inAmount).toBe(fixture.inAmount)
    expect(quote.outAmount).toBe(fixture.outAmount)
    expect(quote.swapMode).toBe(fixture.swapMode)
    expect(quote.routePlan).toEqual(fixture.routePlan)
  })

  test('sends x-api-key header iff jupiterApiKey is set', async () => {
    await buildV2(PARAMS, { jupiterApiKey: 'secret-key' })
    const [, init] = global.fetch.mock.calls[0]
    expect(init.headers['x-api-key']).toBe('secret-key')
  })

  test('omits x-api-key header when no jupiterApiKey', async () => {
    await buildV2(PARAMS, {})
    const [url, init] = global.fetch.mock.calls[0]
    expect(init.headers['x-api-key']).toBeUndefined()
    // keyless default -> lite host
    expect(String(url)).toContain('lite-api.jup.ag')
  })

  test('uses the keyed host when an API key is set', async () => {
    await buildV2(PARAMS, { jupiterApiKey: 'k' })
    const [url] = global.fetch.mock.calls[0]
    expect(String(url)).toContain('api.jup.ag/swap/v2/build')
    expect(String(url)).not.toContain('lite-api')
  })

  test('throws on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' })
    await expect(buildV2(PARAMS, {})).rejects.toThrow('Jupiter v2 /build failed: 400')
  })

  test('passes an AbortSignal timeout to fetch (default 15000ms)', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout')
    await buildV2(PARAMS, {})
    expect(spy).toHaveBeenCalledWith(15000)
    const [, init] = global.fetch.mock.calls[0]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test('honors a custom timeoutMs', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout')
    await buildV2(PARAMS, { timeoutMs: 1234 })
    expect(spy).toHaveBeenCalledWith(1234)
  })

  test('sets computeUnitPricePercentile (cfg) and destinationTokenAccount (params) in the query', async () => {
    await buildV2(
      { ...PARAMS, destinationTokenAccount: 'DestTokenAcct1111111111111111111111111111111' },
      { computeUnitPricePercentile: 25 }
    )
    const [url] = global.fetch.mock.calls[0]
    expect(String(url)).toContain('computeUnitPricePercentile=25')
    expect(String(url)).toContain('destinationTokenAccount=DestTokenAcct1111111111111111111111111111111')
  })

  test('applies route-shaping (dexes array + onlyDirectRoutes) to the query', async () => {
    await buildV2(PARAMS, { dexes: ['Whirlpool', 'Raydium'], onlyDirectRoutes: true })
    const [url] = global.fetch.mock.calls[0]
    expect(String(url)).toContain('dexes=Whirlpool%2CRaydium')
    expect(String(url)).toContain('onlyDirectRoutes=true')
  })
})
