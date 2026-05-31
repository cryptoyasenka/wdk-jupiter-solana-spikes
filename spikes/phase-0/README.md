# Phase-0 de-risk spikes (frozen evidence)

These three scripts are the **Phase-0 de-risk evidence** for `wdk-protocol-swap-jupiter-solana`.
They are throwaway experiments that retired the module's binary risks *before* any module code
was written. They are **frozen**: kept verbatim as a record, not maintained as part of the module.
Do not edit their bodies; the module's real code lives in `src/`.

## What each spike proves

- **`spike-a-bare-fetch-tls.cjs`** — Bare-runtime TLS reachability to Jupiter.
  A single keyless `GET` to Jupiter's free-tier quote endpoint under the **Bare** runtime
  (`bare-fetch`, not Node's `https`). Proves Bare can negotiate TLS to `lite-api.jup.ag`
  and parse the JSON route. Run with `bare`, not `node` (`npm run spike:a`).
  Retires the "Bare-TLS unproven" risk.

- **`spike-b-sim-mainnet.mjs`** — structural validity against real mainnet state, for $0.
  Builds the full Jupiter `/swap-instructions` -> `@solana/kit` instruction path, fetches the
  route's Address Lookup Tables from real mainnet, compresses them into a v0 (versioned)
  message, and finishes with `simulateTransaction`. A **PASS here is structural** (the
  transaction deserializes, ALTs resolve, programs run); a funds-type `err` in the sim is
  EXPECTED because the throwaway wallet has no SOL — settlement is what Surfpool adds.
  Run with `npm run spike:b:sim`. Retires the "ALT / versioned-tx mapping unproven" risk
  without needing a local validator.

- **`spike-b-alt-route-surfpool.mjs`** — full on-chain landing on a Surfpool mainnet fork.
  The same build path as the sim spike, but signed and **landed** on a local Surfpool fork
  (real Jupiter programs + AMM accounts, airdropped SOL, $0). A PASS prints a confirmed
  signature and an increased USDT balance. This spike is the **basis for the T6 end-to-end
  test** (`tests/e2e/surfpool.e2e.test.js`), which re-runs the same flow through
  `WalletAccountSolana.sendTransaction(message)` instead of the raw kit signer.
  Run with `npm run spike:b:surfpool` (requires Surfpool on `http://127.0.0.1:8899`).

## Note

These spikes use `@solana/kit@4.0.0` (a devDependency). The module itself depends on the
granular `@solana/*@3.0.3` packages that `@tetherto/wdk-wallet-solana` uses at runtime, for
type-identity with the wallet's `TransactionMessage`. The spikes are intentionally left on
kit@4 as frozen evidence.
