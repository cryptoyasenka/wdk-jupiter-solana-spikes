import { beforeEach, describe, expect, jest, test } from '@jest/globals'

// --- Mock the wallet package so the class-under-test's `instanceof` checks hit our mocks.
class MockWalletAccountReadOnlySolana {
  constructor (config = {}) {
    this._config = config
    this.getAddress = jest.fn().mockResolvedValue('GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp')
    this.quoteSendTransaction = jest.fn().mockResolvedValue({ fee: 5000n })
    this.sendTransaction = jest.fn().mockResolvedValue({ hash: 'sig-123', fee: 5000n })
    this.getTokenBalance = jest.fn().mockResolvedValue(0n)
  }
}
// WalletAccountSolana must be `instanceof` true for the read-only guard to pass.
class MockWalletAccountSolana extends MockWalletAccountReadOnlySolana {}

jest.unstable_mockModule('@tetherto/wdk-wallet-solana', () => ({
  WalletAccountSolana: MockWalletAccountSolana,
  WalletAccountReadOnlySolana: MockWalletAccountReadOnlySolana,
  default: class {}
}))

// --- Mock the adapters: return a deterministic message + quote.
const FAKE_MESSAGE = { version: 0, instructions: [{ programAddress: 'p', accounts: [], data: new Uint8Array() }] }
const buildV2Mock = jest.fn().mockResolvedValue({
  instructions: [{ programId: 'ComputeBudget111111111111111111111111111111', accounts: [], data: 'Ag==' }],
  lookupTables: {},
  quote: { inAmount: '100000000', outAmount: '8231846', swapMode: 'ExactIn' }
})
const buildV1Mock = jest.fn().mockResolvedValue({
  instructions: [{ programId: 'ComputeBudget111111111111111111111111111111', accounts: [], data: 'Ag==' }],
  lookupTables: {},
  quote: { inAmount: '1203779374', outAmount: '100000000', swapMode: 'ExactOut' }
})
jest.unstable_mockModule('../src/adapters/jupiter-v2.js', () => ({ buildV2: buildV2Mock }))
jest.unstable_mockModule('../src/adapters/jupiter-v1.js', () => ({ buildV1: buildV1Mock }))

// Mock buildSwapMessage so we can assert exactly what is fed to the account.
jest.unstable_mockModule('../src/message.js', () => ({
  buildSwapMessage: jest.fn(() => FAKE_MESSAGE)
}))

const { default: JupiterProtocolSolana } = await import('../index.js')

const WSOL = 'So11111111111111111111111111111111111111112'
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const SELL_OPTIONS = { tokenIn: WSOL, tokenOut: USDT, tokenInAmount: 100_000_000n }
const BUY_OPTIONS = { tokenIn: WSOL, tokenOut: USDT, tokenOutAmount: 100_000_000n }

function makeAccount (Class = MockWalletAccountSolana) {
  return new Class({ provider: 'https://rpc.example' })
}

describe('JupiterProtocolSolana — quoteSwap (SELL)', () => {
  beforeEach(() => {
    buildV2Mock.mockClear()
    buildV1Mock.mockClear()
  })

  test('returns the 3 canonical bigint fields', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, {})
    const out = await protocol.quoteSwap(SELL_OPTIONS)
    expect(out).toEqual({ fee: 5000n, tokenInAmount: 100000000n, tokenOutAmount: 8231846n })
    expect(typeof out.fee).toBe('bigint')
    expect(typeof out.tokenInAmount).toBe('bigint')
    expect(typeof out.tokenOutAmount).toBe('bigint')
  })

  test('routes SELL to v2 by default and passes the built message to quoteSendTransaction', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, {})
    await protocol.quoteSwap(SELL_OPTIONS)
    expect(buildV2Mock).toHaveBeenCalledTimes(1)
    expect(buildV1Mock).not.toHaveBeenCalled()
    expect(account.quoteSendTransaction).toHaveBeenCalledWith(FAKE_MESSAGE)
  })

  test('throws the verbatim provider string when no provider', async () => {
    const account = makeAccount()
    account._config = {} // no provider
    const protocol = new JupiterProtocolSolana(account, {})
    await expect(protocol.quoteSwap(SELL_OPTIONS)).rejects.toThrow(
      'The wallet must be connected to a provider in order to quote swap operations.'
    )
  })
})

describe('JupiterProtocolSolana — swap (SELL)', () => {
  beforeEach(() => {
    buildV2Mock.mockClear()
    buildV1Mock.mockClear()
  })

  test('returns the 4 canonical fields incl. hash', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, {})
    const out = await protocol.swap(SELL_OPTIONS)
    expect(out).toEqual({ hash: 'sig-123', fee: 5000n, tokenInAmount: 100000000n, tokenOutAmount: 8231846n })
  })

  test('passes the SAME built message to quoteSendTransaction and sendTransaction (no feePayer/lifetime)', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, {})
    await protocol.swap(SELL_OPTIONS)
    expect(account.quoteSendTransaction).toHaveBeenCalledWith(FAKE_MESSAGE)
    expect(account.sendTransaction).toHaveBeenCalledWith(FAKE_MESSAGE)
    const passed = account.sendTransaction.mock.calls[0][0]
    expect(passed).toHaveProperty('instructions')
    expect(passed.feePayer).toBeUndefined()
    expect(passed.lifetimeConstraint).toBeUndefined()
  })

  test('fee-exceeded throws the VERBATIM fee string', async () => {
    const account = makeAccount()
    account.quoteSendTransaction = jest.fn().mockResolvedValue({ fee: 10_000n })
    const protocol = new JupiterProtocolSolana(account, { swapMaxFee: 9_999n })
    await expect(protocol.swap(SELL_OPTIONS)).rejects.toThrow('Exceeded maximum fee cost for swap operation.')
    expect(account.sendTransaction).not.toHaveBeenCalled()
  })

  test('does not throw when fee is below swapMaxFee', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, { swapMaxFee: 1_000_000n })
    const out = await protocol.swap(SELL_OPTIONS)
    expect(out.hash).toBe('sig-123')
  })

  test('read-only account throws the VERBATIM read-only string', async () => {
    const account = makeAccount(MockWalletAccountReadOnlySolana)
    const protocol = new JupiterProtocolSolana(account, {})
    await expect(protocol.swap(SELL_OPTIONS)).rejects.toThrow(
      "The 'swap(options)' method requires the protocol to be initialized with a non read-only account."
    )
  })

  test('no provider throws the VERBATIM provider string', async () => {
    const account = makeAccount()
    account._config = {}
    const protocol = new JupiterProtocolSolana(account, {})
    await expect(protocol.swap(SELL_OPTIONS)).rejects.toThrow(
      'The wallet must be connected to a provider in order to perform swap operations.'
    )
  })
})

describe('JupiterProtocolSolana — BUY (ExactOut) routes to v1', () => {
  beforeEach(() => {
    buildV2Mock.mockClear()
    buildV1Mock.mockClear()
  })

  test('BUY always uses v1 with swapMode ExactOut, even with default (v2) config', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, {})
    const out = await protocol.quoteSwap(BUY_OPTIONS)
    expect(buildV1Mock).toHaveBeenCalledTimes(1)
    expect(buildV2Mock).not.toHaveBeenCalled()
    const [params] = buildV1Mock.mock.calls[0]
    expect(params.swapMode).toBe('ExactOut')
    expect(params.amount).toBe(100_000_000n)
    expect(out.tokenOutAmount).toBe(100000000n)
  })
})

describe('JupiterProtocolSolana — _getSwapMessage param mapping', () => {
  beforeEach(() => {
    buildV2Mock.mockClear()
    buildV1Mock.mockClear()
  })

  test('SELL maps tokenIn/tokenOut/amount/taker into adapter params', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, { slippageBps: 75 })
    await protocol.quoteSwap(SELL_OPTIONS)
    const [params, cfg] = buildV2Mock.mock.calls[0]
    expect(params.inputMint).toBe(WSOL)
    expect(params.outputMint).toBe(USDT)
    expect(params.amount).toBe(100_000_000n)
    expect(params.taker).toBe('GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp')
    expect(cfg.slippageBps).toBe(75)
  })

  test('passes `to` through as destinationTokenAccount', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, {})
    await protocol.quoteSwap({ ...SELL_OPTIONS, to: 'DestTokenAcct1111111111111111111111111111111' })
    const [params] = buildV2Mock.mock.calls[0]
    expect(params.destinationTokenAccount).toBe('DestTokenAcct1111111111111111111111111111111')
  })

  test('throws when neither tokenInAmount nor tokenOutAmount is provided', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, {})
    await expect(protocol.quoteSwap({ tokenIn: WSOL, tokenOut: USDT })).rejects.toThrow(
      'A swap requires either tokenInAmount (SELL) or tokenOutAmount (BUY).'
    )
  })
})

describe('JupiterProtocolSolana — SELL routes to v1 when apiVersion=v1', () => {
  beforeEach(() => {
    buildV2Mock.mockClear()
    buildV1Mock.mockClear()
  })

  test('configured apiVersion v1 sends SELL (ExactIn) through buildV1, not buildV2', async () => {
    const account = makeAccount()
    const protocol = new JupiterProtocolSolana(account, { apiVersion: 'v1' })
    await protocol.quoteSwap(SELL_OPTIONS)
    expect(buildV1Mock).toHaveBeenCalledTimes(1)
    expect(buildV2Mock).not.toHaveBeenCalled()
    const [params] = buildV1Mock.mock.calls[0]
    expect(params.amount).toBe(100_000_000n)
    expect(params.swapMode).toBeUndefined()
  })
})
