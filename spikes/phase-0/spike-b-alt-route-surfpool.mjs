/**
 * SPIKE B — real Jupiter ALT / versioned-transaction route composed via
 * @solana/kit and LANDED on a Surfpool mainnet fork, for $0.
 *
 * BINARY RISK this de-risks:
 *   Jupiter routes are NOT simple legacy transactions. They reference 40+
 *   accounts across 8+ programs and only fit inside Solana's 1232-byte packet
 *   by using Address Lookup Tables (ALTs) + a version-0 (versioned)
 *   transaction. The module must therefore:
 *     (a) take Jupiter's raw `/swap-instructions` JSON,
 *     (b) rebuild them as @solana/kit instructions,
 *     (c) compress them against the route's ALTs into a v0 message, and
 *     (d) get that message signed + landed on-chain.
 *   If ANY of (a)-(d) fails with @solana/kit@4.0.0 (the SDK WalletAccountSolana
 *   is built on), the module cannot execute a single real swap. This is the
 *   "ALT handling unproven" binary-risk kill-shot. We prove it against a fork of
 *   REAL mainnet state — not a mock — so it also answers "mocks don't prove
 *   execution" and "no mainnet funds" at the same time.
 *
 * WHY SURFPOOL (the free path):
 *   Surfpool (Solana Foundation / txtx) forks mainnet and lazily loads the
 *   real Jupiter programs + AMM accounts your transaction touches, executing
 *   the swap locally against real state with AIRDROPPED SOL. $0, no mainnet
 *   funds, real execution.
 *
 * HOW TO RUN:
 *   1. Install Surfpool:   https://docs.surfpool.run  (`surfpool start`)
 *      It serves RPC on http://127.0.0.1:8899 and WS on ws://127.0.0.1:8900.
 *   2. From build/spikes/:  npm install   (installs @solana/kit + ALT program)
 *   3. node spike-b-alt-route-surfpool.mjs
 *
 * PASS : prints a confirmed transaction signature; the fork's USDT balance of
 *        the test wallet increased. -> ALT/versioned path through @solana/kit
 *        is proven end-to-end; M2 can swap the kit signer for
 *        `account.sendTransaction(message)` (the WDK account compiles the SAME
 *        v0 message internally — verified from its source).
 * FAIL : capture WHERE it broke (instruction mapping / ALT compression / sign /
 *        land) — that is the exact thing to solve before M2 code.
 *
 * IMPORTANT — helper names to confirm empirically (the point of the spike):
 *   @solana/kit@4.0.0 is modular and fast-moving. The exact export names used
 *   below (compressTransactionMessageUsingAddressLookupTables, the ALT
 *   fetch helper, AccountRole members) MUST be confirmed against the installed
 *   version — do NOT carry them into M2 as assumptions. The build PIPE itself
 *   (createTransactionMessage({version:0}) -> setFeePayerSigner ->
 *   setLifetimeUsingBlockhash -> appendInstructions) is copied verbatim from
 *   the installed wdk-wallet-solana account source, so it matches what the WDK
 *   account expects.
 */

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  address,
  AccountRole,
  lamports
} from '@solana/kit'

import { fetchAddressLookupTable } from '@solana-program/address-lookup-table'

// ---- config (verified mints; Surfpool default endpoints) --------------------
const RPC_HTTP = 'http://127.0.0.1:8899'
const RPC_WS = 'ws://127.0.0.1:8900'
const JUPITER_BASE = 'https://lite-api.jup.ag/swap/v1' // free tier, no key

const WSOL_MINT = 'So11111111111111111111111111111111111111112'
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const AMOUNT_LAMPORTS = 100_000_000n // 0.1 SOL
const SLIPPAGE_BPS = 50

// ---- helpers ----------------------------------------------------------------

// Jupiter AccountMeta { pubkey, isSigner, isWritable } -> @solana/kit role.
function toRole (m) {
  if (m.isSigner && m.isWritable) return AccountRole.WRITABLE_SIGNER
  if (m.isSigner) return AccountRole.READONLY_SIGNER
  if (m.isWritable) return AccountRole.WRITABLE
  return AccountRole.READONLY
}

// Jupiter instruction JSON -> @solana/kit IInstruction.
function toKitInstruction (ix) {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((m) => ({ address: address(m.pubkey), role: toRole(m) })),
    data: new Uint8Array(Buffer.from(ix.data, 'base64'))
  }
}

async function jget (path) {
  const res = await fetch(`${JUPITER_BASE}${path}`)
  if (!res.ok) throw new Error(`Jupiter GET ${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

async function jpost (path, body) {
  const res = await fetch(`${JUPITER_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Jupiter POST ${path} -> ${res.status} ${await res.text()}`)
  return res.json()
}

// ---- main -------------------------------------------------------------------
async function main () {
  const rpc = createSolanaRpc(RPC_HTTP)
  const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS)
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })

  // 1. Test wallet, funded for free on the fork.
  const signer = await generateKeyPairSigner()
  console.log('[spike-b] test wallet:', signer.address)
  const airdropSig = await rpc.requestAirdrop(signer.address, lamports(2_000_000_000n)).send() // 2 SOL
  console.log('[spike-b] airdrop sig :', airdropSig)

  // 2. Quote (real Jupiter route).
  const quote = await jget(
    `/quote?inputMint=${WSOL_MINT}&outputMint=${USDT_MINT}` +
    `&amount=${AMOUNT_LAMPORTS}&slippageBps=${SLIPPAGE_BPS}&restrictIntermediateTokens=true`
  )
  console.log('[spike-b] route hops :', quote.routePlan.length,
    '| out:', quote.outAmount, 'USDT base | impact:', quote.priceImpactPct)

  // 3. Raw instructions (NOT the prebuilt base64 tx — we compose our own).
  const ix = await jpost('/swap-instructions', {
    quoteResponse: quote,
    userPublicKey: signer.address,
    wrapAndUnwrapSol: true,
    // dynamicComputeUnitLimit handled by us via computeBudgetInstructions below
    dynamicComputeUnitLimit: true
  })

  const altAddresses = ix.addressLookupTableAddresses || []
  console.log('[spike-b] ALTs used  :', altAddresses.length)
  if (altAddresses.length === 0) {
    console.warn('[spike-b] WARNING: route used 0 ALTs — pick a deeper route to truly exercise the risk.')
  }

  // Assemble ordered instruction list, kit-shaped.
  const rawList = [
    ...(ix.computeBudgetInstructions || []),
    ...(ix.setupInstructions || []),
    ix.swapInstruction,
    ...(ix.cleanupInstruction ? [ix.cleanupInstruction] : []),
    ...(ix.otherInstructions || [])
  ].filter(Boolean)
  const instructions = rawList.map(toKitInstruction)

  // 4. Fetch ALT contents -> map<altAddress, addresses[]> for compression.
  const lookupTables = {}
  for (const a of altAddresses) {
    const acct = await fetchAddressLookupTable(rpc, address(a))
    lookupTables[a] = acct.data.addresses
  }

  // 5. Build the v0 message — PIPE COPIED FROM wdk-wallet-solana account source,
  //    so the WDK account will accept the identical shape in M2.
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send()
  const baseMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(signer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx)
  )
  // 6. Compress against ALTs — the load-bearing step that legacy txs can't do.
  const message = compressTransactionMessageUsingAddressLookupTables(baseMessage, lookupTables)

  // 7. Sign + land on the fork.
  const signed = await signTransactionMessageWithSigners(message)
  await sendAndConfirm(signed, { commitment: 'confirmed' })
  const sig = getSignatureFromTransaction(signed)

  console.log('\n[spike-b] PASS — confirmed signature:', sig)
  console.log('[spike-b] Verify on the fork explorer or via getTokenAccountsByOwner that USDT arrived.')
  console.log('[spike-b] M2: replace steps 5-7 with account.sendTransaction(message) — same v0 message.')
}

main().catch((err) => {
  console.error('\n[spike-b] FAIL —', err && err.stack ? err.stack : err)
  console.error('[spike-b] Note WHICH step failed (map / ALT fetch / compress / sign / land) before M2.')
  process.exit(1)
})
