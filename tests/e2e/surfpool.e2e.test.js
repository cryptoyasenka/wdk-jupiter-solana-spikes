// Surfpool E2E — the live landing test behind DESIGN §4c.
//
// Proves the one empirical risk the unit tests cannot: the module's `buildSwapMessage`
// compresses the Jupiter instruction list with Address Lookup Tables and emits a v0
// `TransactionMessage` with NO fee payer and NO lifetime — and the WDK wallet's
// `_prepareTransactionMessage` then sets fee payer + lifetime + signer AFTER that
// compression. This test runs a REAL swap (WSOL -> USDT) on a Surfpool mainnet fork
// through the real `JupiterProtocolSolana.swap()` -> `WalletAccountSolana`, confirms it,
// and asserts the on-chain USDT balance increased.
//
// It conditionally SKIPS when `SURFPOOL_RPC` (default http://127.0.0.1:8899) is not
// reachable, so a plain `npm test` (no validator) stays green. To run it:
//
//   1) install + start Surfpool on 127.0.0.1:8899 (mainnet fork) — see tests/e2e/README.md
//   2) SURFPOOL_RPC=http://127.0.0.1:8899 npm test
//
// Runs under brittle-node (it needs the real WDK wallet + Solana RPC over Node APIs);
// the brittle-bare run excludes it.
//
// Route is pinned to a single Orca Whirlpool hop (`dexes:'Whirlpool', onlyDirectRoutes`)
// with a small amount: a mainnet fork lazily loads accounts from a public datasource, and
// a single deep, well-indexed pool keeps every required account serveable + the tx within
// the size limit. The bounded retry absorbs the rare datasource race / route-size variant.

import test from 'brittle'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as bip39 from 'bip39'
import { createSolanaRpc } from '@solana/rpc'
import { address } from '@solana/addresses'

import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import JupiterProtocolSolana from '../../index.js'
import { buildV2 } from '../../src/adapters/jupiter-v2.js'

const RPC = process.env.SURFPOOL_RPC || 'http://127.0.0.1:8899'
const WSOL = 'So11111111111111111111111111111111111111112'
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const AMOUNT = 10_000_000n // 0.01 WSOL
const CONFIG = { slippageBps: 300, dexes: 'Whirlpool', onlyDirectRoutes: true }
const __dirname = dirname(fileURLToPath(import.meta.url))
const EVIDENCE = resolve(__dirname, '../../evidence/surfpool-e2e.txt')

const rpc = createSolanaRpc(RPC)

// Reachability gate: is a Surfpool/Solana RPC answering on RPC? Decides skip vs run.
async function reachable () {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal: AbortSignal.timeout(2000)
    })
    if (!res.ok) return false
    const json = await res.json()
    return json?.result === 'ok'
  } catch {
    return false
  }
}

async function airdrop (addr, lamports) {
  await rpc.requestAirdrop(address(addr), lamports).send()
  for (let i = 0; i < 40; i++) {
    const { value } = await rpc.getBalance(address(addr), { commitment: 'confirmed' }).send()
    if (value > 0n) return value
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error('airdrop did not land')
}

// Force the fork to lazily load an account into its local cache (single fetch; the public
// datasource serves singles but rate-limits large getMultipleAccounts bursts).
async function warm (addr) {
  try {
    await rpc.getAccountInfo(address(addr), { encoding: 'base64', commitment: 'confirmed' }).send()
  } catch { /* a missing/un-served account is surfaced later by simulation */ }
}

// Pre-warm every account the swap will touch by building the same v2 quote the module uses.
async function prewarm (taker) {
  const { instructions, lookupTables } = await buildV2(
    { inputMint: WSOL, outputMint: USDT, amount: AMOUNT, taker }, CONFIG
  )
  const set = new Set()
  for (const ix of instructions) {
    set.add(ix.programId)
    for (const a of ix.accounts) set.add(a.pubkey)
  }
  for (const [table, addrs] of Object.entries(lookupTables || {})) {
    set.add(table)
    for (const a of addrs) set.add(a)
  }
  const all = [...set]
  for (let i = 0; i < all.length; i += 4) {
    await Promise.all(all.slice(i, i + 4).map(warm))
  }
}

async function confirm (signature) {
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()
    const status = value[0]
    if (status) {
      if (status.err) throw new Error('tx failed on-chain: ' + JSON.stringify(status.err))
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return status
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error('tx not confirmed in time')
}

const RUN = await reachable()
// brittle has no describe/skip-suite; gate the single test on reachability so a plain run
// (no validator) cleanly SKIPS instead of failing.
const e2e = RUN ? test : test.skip
if (!RUN) {
  // eslint-disable-next-line no-console
  console.warn(`[surfpool.e2e] SKIPPED — no RPC at ${RPC}. Start Surfpool and set SURFPOOL_RPC to run (see tests/e2e/README.md).`)
}

e2e('Surfpool E2E — real WSOL->USDT swap lands and increases USDT (DESIGN §4c)', async (t) => {
  t.timeout(300_000)

  // setup (was beforeAll): fresh wallet, airdrop, snapshot pre-balance.
  const wallet = new WalletManagerSolana(bip39.generateMnemonic(), { provider: RPC, commitment: 'confirmed' })
  const account = await wallet.getAccount(0)
  const addr = await account.getAddress()
  await airdrop(addr, 5_000_000_000n) // 5 SOL for fees + wrap
  const preUsdt = await account.getTokenBalance(USDT)

  const protocol = new JupiterProtocolSolana(account, CONFIG)

  // Bounded retry: a free public datasource occasionally fails to serve a route variant's
  // accounts (or returns a too-large tx); re-quoting + re-warming lands a serveable route.
  let result
  let lastErr
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      await prewarm(addr)
      result = await protocol.swap({ tokenIn: WSOL, tokenOut: USDT, tokenInAmount: AMOUNT })
      break
    } catch (err) {
      lastErr = err
      await new Promise(resolve => setTimeout(resolve, 700))
    }
  }
  if (!result) throw lastErr

  const status = await confirm(result.hash)
  const postUsdt = await account.getTokenBalance(USDT)

  // The actual assertion: a real on-chain USDT balance increase.
  t.ok(postUsdt > preUsdt, 'USDT post > pre')
  t.is(typeof result.hash, 'string')
  t.ok(result.hash.length > 0)

  // Persist proof (real signature + pre/post + delta) for the audit.
  const delta = postUsdt - preUsdt
  const lines = [
    'Surfpool E2E — real WSOL->USDT swap (DESIGN §4c: feePayer/lifetime applied AFTER ALT compression still lands)',
    `timestamp:   ${new Date().toISOString()}`,
    `rpc:         ${RPC}`,
    `wallet:      ${addr}`,
    'route:       dexes=Whirlpool onlyDirectRoutes (single hop)',
    `tx hash:     ${result.hash}`,
    `slot:        ${status.slot}`,
    `amount in:   ${result.tokenInAmount} (WSOL base units)`,
    `quote out:   ${result.tokenOutAmount} (USDT base units)`,
    `pre  USDT:   ${preUsdt}`,
    `post USDT:   ${postUsdt}`,
    `delta:       +${delta}`,
    `fee:         ${result.fee}`,
    'adapter:     v2 /build (ExactIn SELL, default path)',
    ''
  ].join('\n')
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, lines)
  // eslint-disable-next-line no-console
  console.log(lines)
})
