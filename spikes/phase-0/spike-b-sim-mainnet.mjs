/**
 * SPIKE B (sim) — free, here-and-now companion to spike-b-alt-route-surfpool.mjs.
 *
 * Surfpool (the full-landing path) needs a local mainnet-fork daemon. When it
 * is not installed, THIS script retires the *core* of the same binary risk for
 * $0 by running the identical build path against REAL mainnet state and
 * finishing with `simulateTransaction` instead of send+confirm.
 *
 * What a green run here PROVES (the load-bearing unknowns):
 *   1. Jupiter `/swap-instructions` JSON maps cleanly to @solana/kit instructions.
 *   2. The route's ALTs are fetched from real mainnet (`fetchAddressLookupTable`).
 *   3. `compressTransactionMessageUsingAddressLookupTables` compresses them.
 *   4. A v0 (versioned) message compiles to a wire transaction that the
 *      validator ACCEPTS and EXECUTES (programs run; ALTs resolve).
 *
 * What it does NOT prove (Surfpool adds this): final landing + a real USDT
 * balance delta. A funds-type `err` in the sim is EXPECTED here — the test
 * wallet is a throwaway key with no SOL; that is exactly what Surfpool's local
 * airdrop fixes. The de-risk is structural validity, not settlement.
 *
 * RUN:  node spike-b-sim-mainnet.mjs
 * PASS: simulateTransaction RETURNS a result (tx accepted + executed in sim) —
 *       i.e. NO deserialize / "AddressLookupTable not found" / account-lock
 *       error. err/unitsConsumed/logs are printed for full transparency.
 * FAIL: the RPC rejects the transaction (that means the ALT/versioned/kit path
 *       is the problem — solve before M2).
 */

import {
  createSolanaRpc,
  generateKeyPairSigner,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  address,
  AccountRole
} from '@solana/kit'
import { fetchAddressLookupTable } from '@solana-program/address-lookup-table'

const RPC_HTTP = process.env.SOLANA_RPC || 'https://solana-rpc.publicnode.com'
const JUPITER_BASE = 'https://lite-api.jup.ag/swap/v1'
const WSOL_MINT = 'So11111111111111111111111111111111111111112'
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const AMOUNT_LAMPORTS = 100_000_000n
const SLIPPAGE_BPS = 50

function toRole (m) {
  if (m.isSigner && m.isWritable) return AccountRole.WRITABLE_SIGNER
  if (m.isSigner) return AccountRole.READONLY_SIGNER
  if (m.isWritable) return AccountRole.WRITABLE
  return AccountRole.READONLY
}
function toKitInstruction (ix) {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((m) => ({ address: address(m.pubkey), role: toRole(m) })),
    data: new Uint8Array(Buffer.from(ix.data, 'base64'))
  }
}
async function jget (path) {
  const r = await fetch(`${JUPITER_BASE}${path}`)
  if (!r.ok) throw new Error(`Jupiter GET ${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}
async function jpost (path, body) {
  const r = await fetch(`${JUPITER_BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(`Jupiter POST ${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}

async function main () {
  const rpc = createSolanaRpc(RPC_HTTP)
  const signer = await generateKeyPairSigner()
  console.log('[spike-b-sim] rpc        :', RPC_HTTP)
  console.log('[spike-b-sim] test wallet:', signer.address, '(throwaway, unfunded — funds err is expected)')

  const quote = await jget(
    `/quote?inputMint=${WSOL_MINT}&outputMint=${USDT_MINT}` +
    `&amount=${AMOUNT_LAMPORTS}&slippageBps=${SLIPPAGE_BPS}&restrictIntermediateTokens=true`
  )
  console.log('[spike-b-sim] route hops :', quote.routePlan.length, '| out:', quote.outAmount, 'USDT base')

  const ix = await jpost('/swap-instructions', {
    quoteResponse: quote, userPublicKey: signer.address, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true
  })
  const altAddresses = ix.addressLookupTableAddresses || []
  console.log('[spike-b-sim] ALTs used  :', altAddresses.length)

  const rawList = [
    ...(ix.computeBudgetInstructions || []),
    ...(ix.setupInstructions || []),
    ix.swapInstruction,
    ...(ix.cleanupInstruction ? [ix.cleanupInstruction] : []),
    ...(ix.otherInstructions || [])
  ].filter(Boolean)
  const instructions = rawList.map(toKitInstruction)
  console.log('[spike-b-sim] instr count:', instructions.length)

  // Fetch the real ALTs from mainnet -> compression map.
  const lookupTables = {}
  for (const a of altAddresses) {
    const acct = await fetchAddressLookupTable(rpc, address(a))
    lookupTables[a] = acct.data.addresses
  }
  console.log('[spike-b-sim] ALT entries:', Object.values(lookupTables).reduce((n, x) => n + x.length, 0))

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()
  // PIPE copied verbatim from wdk-wallet-solana account source.
  const baseMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  )
  const message = compressTransactionMessageUsingAddressLookupTables(baseMessage, lookupTables)
  const signed = await signTransactionMessageWithSigners(message)
  const wire = getBase64EncodedWireTransaction(signed)
  console.log('[spike-b-sim] v0 wire tx  : compiled,', wire.length, 'base64 chars')

  // sigVerify:false + replaceRecentBlockhash:true => no funds-for-fees / stale-hash noise;
  // we are testing structural validity + ALT resolution + program execution.
  const sim = await rpc.simulateTransaction(wire, {
    encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true
  }).send()

  const v = sim.value
  console.log('\n[spike-b-sim] --- simulation result ---')
  console.log('[spike-b-sim] err           :', JSON.stringify(v.err))
  console.log('[spike-b-sim] unitsConsumed :', v.unitsConsumed)
  console.log('[spike-b-sim] logs (tail)   :')
  for (const l of (v.logs || []).slice(-12)) console.log('   ', l)

  // De-risk classification (audit finding #4: the old `v.err !== 'BlockhashNotFound'`
  // printed PASS for almost any error). The wire tx already COMPILED (parse + ALT
  // compression OK). To PASS we now require the validator to have GENUINELY exercised
  // the versioned/ALT path:
  //   1. ALTs must actually be present (>0 tables AND >0 entries) — else this proves
  //      nothing about lookup tables; and
  //   2. the error must NOT be a deserialize / ALT-resolution / sanitize failure (those
  //      mean the exact path we de-risk is broken).
  // An account-loading / funds err (e.g. AccountNotFound) on an unfunded throwaway wallet
  // means parse + ALT-resolution + account loading were all REACHED — which is what
  // Surfpool's airdrop turns into a real landing. It does NOT prove program execution,
  // and we say so explicitly below unless logs/CU are present.
  const altTableCount = Object.keys(lookupTables).length
  const altEntryCount = Object.values(lookupTables).reduce((n, x) => n + x.length, 0)
  const errName = v.err == null ? null : (typeof v.err === 'string' ? v.err : Object.keys(v.err)[0])
  const PATH_BROKEN = [
    'BlockhashNotFound', 'SanitizeFailure', 'AddressLookupTableNotFound',
    'InvalidAddressLookupTableData', 'InvalidAddressLookupTableIndex',
    'InvalidAddressLookupTableOwner', 'TooManyAccountLocks'
  ]
  const pathBroken = PATH_BROKEN.includes(errName)
  const executed = Number(v.unitsConsumed || 0) > 0 || (v.logs && v.logs.length > 0)
  const altPathProven = altTableCount > 0 && altEntryCount > 0 && !pathBroken

  if (!altPathProven) {
    console.error('\n[spike-b-sim] FAIL — versioned/ALT path NOT proven.')
    console.error(`[spike-b-sim]   altTables=${altTableCount} altEntries=${altEntryCount} err=${JSON.stringify(v.err)}`)
    console.error('[spike-b-sim]   A deserialize / AddressLookupTable* / SanitizeFailure / BlockhashNotFound error means')
    console.error('[spike-b-sim]   the path we de-risk is broken — fix before building the M2 module.')
    process.exit(1)
  }

  console.log(`\n[spike-b-sim] PASS (structural) — validator PARSED the v0 tx, RESOLVED ${altTableCount} ALT(s) / ${altEntryCount} entries, and reached account loading.`)
  if (executed) {
    console.log(`[spike-b-sim] + program execution OBSERVED (unitsConsumed=${v.unitsConsumed}, ${(v.logs || []).length} log lines).`)
  } else {
    console.log(`[spike-b-sim] NOT proven here: program EXECUTION (unitsConsumed=${v.unitsConsumed}, no logs; err=${JSON.stringify(v.err)} is the EXPECTED account-loading outcome on an unfunded throwaway wallet).`)
  }
  console.log('[spike-b-sim] PROVEN free, vs real mainnet state: Jupiter instr -> @solana/kit mapping, ALT')
  console.log('[spike-b-sim] fetch, ALT compression, v0 compile, validator parse + ALT resolution + account loading.')
  console.log('[spike-b-sim] NOT proven here (needs Surfpool airdrop): full program execution + landing + real')
  console.log('[spike-b-sim] USDT balance delta -> run the Surfpool E2E (spikes/phase-0 or test/e2e).')
}

main().catch((err) => {
  console.error('\n[spike-b-sim] FAIL —', err && err.stack ? err.stack : err)
  console.error('[spike-b-sim] If this is a deserialize / "AddressLookupTable not found" / account-lock')
  console.error('[spike-b-sim] error, the ALT/versioned/kit path is the real problem to solve before M2.')
  console.error('[spike-b-sim] (A public-RPC rate-limit/429 is infra noise — set SOLANA_RPC to a better endpoint.)')
  process.exit(1)
})
