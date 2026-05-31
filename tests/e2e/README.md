# Surfpool E2E — live landing test

`surfpool.e2e.test.js` runs a **real** `WSOL -> USDT` swap on a [Surfpool](https://github.com/txtx/surfpool)
mainnet fork through the module's real `JupiterProtocolSolana.swap()` and the WDK
`WalletAccountSolana`, confirms the transaction, and asserts the on-chain USDT balance
increased. It is the empirical proof behind **DESIGN §4c**: the module emits an
ALT-compressed v0 `TransactionMessage` with **no** fee payer and **no** lifetime, the
wallet's `_prepareTransactionMessage` sets those **after** the compression, and the
transaction still lands on-chain.

The test **conditionally skips** when no Solana RPC answers `getHealth` at `SURFPOOL_RPC`
(default `http://127.0.0.1:8899`), so a plain `npm test` stays green in CI / on machines
without a validator. It only runs when a fork is actually up.

## Run it

Surfpool ships a native Windows x64 binary (also Linux/macOS). Verified on Windows 11.

```sh
# 1) install Surfpool (example: Windows x64 release tarball)
curl.exe -sL https://github.com/txtx/surfpool/releases/download/v1.3.0/surfpool-windows-x64.tar.gz -o surfpool.tar.gz
tar -xzf surfpool.tar.gz                     # -> surfpool.exe

# 2) start a mainnet fork, headless, on 127.0.0.1:8899
#    (-u <datasource RPC> is the upstream the fork lazily loads accounts from)
surfpool.exe start --no-tui -u https://solana-rpc.publicnode.com

# 3) in another shell, run the suite against it
SURFPOOL_RPC=http://127.0.0.1:8899 npm test
```

On Linux/macOS use the matching release asset; everything else is identical.

Evidence from a green run (real signature + pre/post balances + delta) is written to
`evidence/surfpool-e2e.txt`.

## Why the route is pinned (`dexes:'Whirlpool', onlyDirectRoutes`)

A mainnet fork **lazily** loads accounts from a datasource RPC on demand. Two practical
constraints follow when the datasource is a **free public RPC**:

1. **Account coverage.** Jupiter routes against live mainnet and may pick AMM pools whose
   accounts a free datasource does not serve (`getAccountInfo` returns `null`). Surfpool
   then can't materialize those accounts and simulation fails with `Invalid account owner`.
   This is a *datasource* limitation, not a module defect — verified by querying the
   datasource directly: the failing accounts return `null` upstream.
2. **Burst rate-limits.** Free RPCs (e.g. publicnode) reject large `getMultipleAccounts`
   batches (HTTP 403) but serve single `getAccountInfo` calls. The test therefore
   **pre-warms** every route account with single fetches before the swap so the fork has
   them cached when it simulates.

Pinning to a single **Orca Whirlpool** hop with a small amount keeps every required account
serveable by the free datasource and the transaction within the v0 size limit, giving a
deterministic landing. `dexes` / `onlyDirectRoutes` are Jupiter-native route-shaping params
exposed by the module's config (`JupiterProtocolConfig`) — useful beyond this test for
callers who want to constrain routing. With a **paid mainnet RPC** as the datasource the
route pin is unnecessary; the unconstrained default route lands too.

The bounded retry in the test re-quotes + re-warms to absorb the rare free-datasource race
or an occasional oversized route variant.
