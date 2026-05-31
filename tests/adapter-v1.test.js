import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const quoteFixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v1-quote.json'), 'utf8'))
const ixFixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'jupiter-v1-swap-instructions.json'), 'utf8'))

// Stub fetchAddressLookupTable so no real RPC is hit; return a deterministic address list per table.
const fetchAltMock = jest.fn(async (_rpc, addr) => ({
  data: { addresses: [`${addr}-a`, `${addr}-b`] }
}))
jest.unstable_mockModule('@solana-program/address-lookup-table', () => ({
  fetchAddressLookupTable: fetchAltMock
}))

const { buildV1 } = await import('../src/adapters/jupiter-v1.js')
const { COMPUTE_BUDGET_PROGRAM } = await import('../src/constants.js')

const PARAMS = {
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  amount: '100000000',
  taker: 'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp',
  slippageBps: 50
}

const FAKE_RPC = { _fake: true }

function res (body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

describe('buildV1', () => {
  beforeEach(() => {
    fetchAltMock.mockClear()
    // 1st call = GET /quote, 2nd call = POST /swap-instructions
    global.fetch = jest.fn()
      .mockResolvedValueOnce(res(quoteFixture))
      .mockResolvedValueOnce(res(ixFixture))
  })
  afterEach(() => {
    jest.restoreAllMocks()
    delete global.fetch
  })

  test('returns the shared internal { instructions, lookupTables, quote } shape', async () => {
    const out = await buildV1(PARAMS, {}, FAKE_RPC)
    expect(out).toHaveProperty('instructions')
    expect(out).toHaveProperty('lookupTables')
    expect(out).toHaveProperty('quote')
  })

  test('does NOT prepend a SetComputeUnitLimit (v1 emits its own)', async () => {
    const { instructions } = await buildV1(PARAMS, {}, FAKE_RPC)
    const ungrouped = [
      ...ixFixture.computeBudgetInstructions,
      ...ixFixture.setupInstructions,
      ixFixture.swapInstruction,
      ...(ixFixture.cleanupInstruction ? [ixFixture.cleanupInstruction] : []),
      ...ixFixture.otherInstructions
    ].filter(Boolean)
    // no extra instruction added
    expect(instructions).toHaveLength(ungrouped.length)
    // first instruction is the fixture's own first computeBudget (the CU-limit Jupiter emitted)
    expect(instructions[0]).toEqual(ixFixture.computeBudgetInstructions[0])
    expect(instructions[0].programId).toBe(COMPUTE_BUDGET_PROGRAM)
  })

  test('ungroups in order computeBudget -> setup -> swap -> cleanup -> other', async () => {
    const { instructions } = await buildV1(PARAMS, {}, FAKE_RPC)
    const swapIdx = instructions.findIndex((i) => i === ixFixture.swapInstruction)
    const before = ixFixture.computeBudgetInstructions.length + ixFixture.setupInstructions.length
    expect(swapIdx).toBe(before)
  })

  test('fetches each ALT via fetchAddressLookupTable and builds the contents map', async () => {
    const { lookupTables } = await buildV1(PARAMS, {}, FAKE_RPC)
    expect(fetchAltMock).toHaveBeenCalledTimes(ixFixture.addressLookupTableAddresses.length)
    for (const a of ixFixture.addressLookupTableAddresses) {
      expect(lookupTables[a]).toEqual([`${a}-a`, `${a}-b`])
    }
  })

  test('quote is the /quote response', async () => {
    const { quote } = await buildV1(PARAMS, {}, FAKE_RPC)
    expect(quote.inAmount).toBe(quoteFixture.inAmount)
    expect(quote.outAmount).toBe(quoteFixture.outAmount)
  })

  test('posts quoteResponse + userPublicKey to /swap-instructions', async () => {
    await buildV1(PARAMS, {}, FAKE_RPC)
    const [url, init] = global.fetch.mock.calls[1]
    expect(String(url)).toContain('/swap/v1/swap-instructions')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.userPublicKey).toBe(PARAMS.taker)
    expect(body.quoteResponse.outAmount).toBe(quoteFixture.outAmount)
    expect(body.wrapAndUnwrapSol).toBe(true)
    expect(body.dynamicComputeUnitLimit).toBe(true)
  })

  test('passes swapMode=ExactOut into the /quote query when set', async () => {
    await buildV1({ ...PARAMS, swapMode: 'ExactOut' }, {}, FAKE_RPC)
    const [url] = global.fetch.mock.calls[0]
    expect(String(url)).toContain('swapMode=ExactOut')
    expect(String(url)).toContain('restrictIntermediateTokens=true')
  })

  test('passes an AbortSignal timeout to both fetches (default 15000ms)', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout')
    await buildV1(PARAMS, {}, FAKE_RPC)
    expect(spy).toHaveBeenCalledWith(15000)
    const [, init0] = global.fetch.mock.calls[0]
    const [, init1] = global.fetch.mock.calls[1]
    expect(init0.signal).toBeInstanceOf(AbortSignal)
    expect(init1.signal).toBeInstanceOf(AbortSignal)
  })

  test('throws when /quote responds non-ok', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'rate limited' })
    await expect(buildV1(PARAMS, {}, FAKE_RPC)).rejects.toThrow('Jupiter v1 /quote failed: 500')
  })

  test('throws when /swap-instructions responds non-ok', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(res(quoteFixture))
      .mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'bad quote' })
    await expect(buildV1(PARAMS, {}, FAKE_RPC)).rejects.toThrow('Jupiter v1 /swap-instructions failed: 422')
  })

  test('applies route-shaping + destinationTokenAccount (v1 parity with v2)', async () => {
    await buildV1(
      { ...PARAMS, destinationTokenAccount: 'DestTokenAcct1111111111111111111111111111111' },
      { dexes: 'Whirlpool', onlyDirectRoutes: true },
      FAKE_RPC
    )
    const [quoteUrl] = global.fetch.mock.calls[0]
    expect(String(quoteUrl)).toContain('dexes=Whirlpool')
    expect(String(quoteUrl)).toContain('onlyDirectRoutes=true')
    const [, ixInit] = global.fetch.mock.calls[1]
    expect(JSON.parse(ixInit.body).destinationTokenAccount).toBe('DestTokenAcct1111111111111111111111111111111')
  })
})
