# Phase-0 de-risk spikes — `wdk-protocol-swap-jupiter-solana`

Two throwaway experiments that retire the **two binary risks** of a Jupiter-based
same-chain Solana swap module for [Tether's WDK](https://docs.wallet.tether.io)
*before* a single line of module code is written. If either had failed, the
approach changes now — not three weeks into implementation.

This repo is the runnable evidence behind the **design proposal** for a WDK swap
protocol module (`wdk-protocol-swap-jupiter-solana`) — the Solana peer of the
official EVM swap module `@tetherto/wdk-protocol-swap-velora-evm`. The point is
simple: don't ask anyone to *trust* that the hard parts work — let them run it.

## Results (run 2026-05-27)

| Spike | Status | Evidence |
|---|---|---|
| **A** — Bare TLS → Jupiter | ✅ **PASS (run for real, under `bare`)** | HTTP **200 in 175 ms**; a real route `0.1 SOL → 8.389569 USDT` via Whirlpool. The "can the module even reach Jupiter over HTTPS inside the Bare runtime?" risk is **retired**. |
| **B (sim)** — ALT / versioned tx via `@solana/kit` vs live mainnet | ✅ **PASS (structural, run for real)** | Fetched 2 real mainnet Address Lookup Tables (**505 addresses**), compressed them, compiled a **v0 wire transaction (1284 base64 chars)**; `simulateTransaction` returned an expected `AccountNotFound` on the unfunded throwaway wallet — i.e. the validator **parsed the versioned tx and resolved the ALTs**. The ALT/versioned/`kit` risk is **retired**. |
| **B (full)** — landing + USDT balance delta on a Surfpool fork | ⏳ **NOT run here** | Needs [Surfpool](https://docs.surfpool.run) (a Rust binary) installed. The script is ready (`spike-b-alt-route-surfpool.mjs`); the full on-chain landing is part of implementation (M2), at $0 on a local mainnet fork. |

> **Honest scope:** Spikes **A** and **B(sim)** ran for real and retire both
> *binary* risks (Bare can reach Jupiter over TLS; a real Jupiter ALT/versioned
> route composes through `@solana/kit` and the validator accepts it). **B(full)**
> — the final settled-on-chain landing with a USDT balance delta — has **not** been
> run here (no Surfpool on the box it was written on); it is implementation-phase
> work, deliberately not claimed as done.

| Spike | Risk it retires | Runtime | Cost |
|---|---|---|---|
| **A** `spike-a-bare-fetch-tls.cjs` | Bare-TLS unproven — can the module reach Jupiter over HTTPS from inside Bare? | **Bare** | $0 |
| **B (sim)** `spike-b-sim-mainnet.mjs` | ALT handling unproven — compose a real Jupiter ALT/versioned route via `@solana/kit` and have the validator parse + resolve it (simulate vs live mainnet) | Node | $0 |
| **B (full)** `spike-b-alt-route-surfpool.mjs` | "mocks don't prove execution" + "no mainnet funds" — **land** the swap on real (forked) state | Node + Surfpool | $0 |

## Run them

```sh
npm install
```

### Spike A — Bare TLS to Jupiter  (PASS)
```sh
npm run spike:a        # = bare spike-a-bare-fetch-tls.cjs
```
- **Must** run under `bare`, not `node` — Node's TLS is not the runtime under
  test. The script prints whether it actually saw the `Bare` global.
- The `.cjs` extension is required: the package is `"type": "module"`, so a bare
  `.js` would be treated as ESM and `require('bare-fetch')` would fail.
- **PASS:** HTTP 200 + a real `outAmount` + a non-empty `routePlan`.

### Spike B (sim) — ALT/versioned vs live mainnet, no Surfpool needed  (PASS)
```sh
npm run spike:b:sim
# default RPC is solana-rpc.publicnode.com — works from datacenter IPs (unlike
# api.mainnet-beta.solana.com, which refuses them). Override: SOLANA_RPC=<endpoint>
```
- Runs the full build path (Jupiter `/swap-instructions` → `@solana/kit` → fetch
  ALTs from mainnet → compress → compile v0) and finishes with
  `simulateTransaction` (`sigVerify:false`, `replaceRecentBlockhash:true`) — $0,
  no funds, no landing.
- **PASS:** the sim returns a result (the validator parsed the v0 tx + resolved
  the ALTs); an `AccountNotFound`/funds error on the throwaway wallet is expected.

### Spike B (full) — landing on a Surfpool fork  (not run here)
```sh
# terminal 1: fork mainnet locally — see https://docs.surfpool.run
surfpool start          # RPC :8899, WS :8900
# terminal 2:
npm run spike:b:surfpool
```
- Surfpool lazily loads the real Jupiter programs + AMM accounts the swap touches
  and funds the test wallet with a free local airdrop.
- **PASS:** a confirmed transaction signature; the wallet's USDT balance on the
  fork increased.

## What was confirmed against the installed packages (2026-05-27)

1. **`bare-fetch`** — version **3.0.1**; `module.exports = fetch`, so
   `const fetch = require('bare-fetch')` is correct. `Response` exposes
   `.ok` / `.status` / `.json()`. It is **Bare-only** (Node `require` throws on
   `require.addon`) — exactly why Spike A must run under `bare`.
2. **`@solana/kit@4.0.0` ALT helpers** — all imports used by the spikes exist;
   `AccountRole = { READONLY:0, WRITABLE:1, READONLY_SIGNER:2, WRITABLE_SIGNER:3 }`;
   `compressTransactionMessageUsingAddressLookupTables`, `compileTransaction`,
   `getBase64EncodedWireTransaction` all present.
3. **ALT package** — `@solana-program/address-lookup-table@0.9.0` is the version
   whose peer is `@solana/kit@^4.0` (0.7.0 peers ^2, 0.11.0 peers ^6 — both wrong);
   `fetchAddressLookupTable` present and works against live mainnet.
4. **Jupiter host** — keyless `lite-api.jup.ag/swap/v1` (`/quote` + `/swap-instructions`)
   returned a live 200 from both Bare and Node. The keyed host `api.jup.ag` serves the same
   v1 contract for higher limits; Jupiter's newer Unified Swap **v2** (`api.jup.ag/swap/v2` —
   `/order`·`/build`·`/execute`) is a different surface, but because the module consumes
   *raw instructions* and composes the tx itself, the Jupiter source stays behind a thin
   adapter, not the module's transaction logic.

## Why this is the cheap path

The transaction-build **pipe** in Spike B
(`createTransactionMessage({ version: 0 })` → `setTransactionMessageFeePayerSigner`
→ `setTransactionMessageLifetimeUsingBlockhash` →
`appendTransactionMessageInstructions`) is copied verbatim from the installed
`@tetherto/wdk-wallet-solana` account source. So a green Spike B means the module
only has to swap the local `@solana/kit` signer for `account.sendTransaction(message)`
— the WDK account compiles the **same** v0 message internally. The risky unknowns
are isolated here, at $0, before the module exists.

## License

MIT © cryptoyasenka
