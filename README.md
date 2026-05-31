# wdk-protocol-swap-jupiter-solana

A Solana swap protocol for [Tether's WDK](https://docs.wdk.tether.io): lets a
`@tetherto/wdk-wallet-solana` wallet account swap SPL tokens through the
[Jupiter](https://dev.jup.ag) aggregator. The Solana peer of the official EVM swap
module [`@tetherto/wdk-protocol-swap-velora-evm`](https://github.com/tetherto/wdk-protocol-swap-velora-evm) —
same `swap(options)` / `quoteSwap(options)` surface, same
`{ hash, fee, tokenInAmount, tokenOutAmount }` returns.

It extends the WDK `SwapProtocol` base contract and builds a Solana `TransactionMessage`
from Jupiter's raw instructions; the wallet account sets the fee payer, lifetime, and
signature, then sends it.

## Install

```sh
npm i wdk-protocol-swap-jupiter-solana
```

`--ignore-scripts` is supported (and recommended) — the package has no install/build step
of its own:

```sh
npm i wdk-protocol-swap-jupiter-solana --ignore-scripts
```

Runtime peer: `@tetherto/wdk-wallet-solana` (the wallet that provides the account this
protocol operates on). The granular `@solana/*` primitives the module builds transactions
with are pinned to the versions the wallet uses, so the produced `TransactionMessage` is
type-identical to what the wallet expects.

## Quick start

```js
import WalletManagerSolana from '@tetherto/wdk-wallet-solana'
import JupiterProtocolSolana from 'wdk-protocol-swap-jupiter-solana'

const WSOL = 'So11111111111111111111111111111111111111112'
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'

// A wallet connected to an RPC provider (failover array also supported).
const wallet = new WalletManagerSolana(mnemonic, { provider: 'https://your-solana-rpc' })
const account = await wallet.getAccount(0)

const protocol = new JupiterProtocolSolana(account, { slippageBps: 50 })

// Quote only (no transaction sent). Returns bigints.
const quote = await protocol.quoteSwap({
  tokenIn: WSOL,
  tokenOut: USDT,
  tokenInAmount: 10_000_000n // 0.01 WSOL, in base units
})
// quote = { fee, tokenInAmount, tokenOutAmount }

// Build, fee-guard, and send. Returns the quote fields plus the transaction hash.
const result = await protocol.swap({
  tokenIn: WSOL,
  tokenOut: USDT,
  tokenInAmount: 10_000_000n
})
// result = { hash, fee, tokenInAmount, tokenOutAmount }
```

`swap()` requires a signing account (a `WalletAccountSolana`) connected to a provider;
`quoteSwap()` works on any provider-connected account, including a read-only one.

## API

### `new JupiterProtocolSolana(account, config?)`

- `account` — a `WalletAccountSolana` (signing) or `WalletAccountReadOnlySolana`
  (quote-only) from `@tetherto/wdk-wallet-solana`.
- `config` — a [`JupiterProtocolConfig`](#configuration) (optional).

### `quoteSwap(options)` → `Promise<{ fee, tokenInAmount, tokenOutAmount }>`

Quotes a swap without sending it. All three returned values are `bigint`.

### `swap(options)` → `Promise<{ hash, fee, tokenInAmount, tokenOutAmount }>`

Builds the swap transaction, quotes its fee, enforces the `swapMaxFee` guard, sends it
through the account, and returns the (quoted) fee alongside the on-chain `hash`. `fee`,
`tokenInAmount`, and `tokenOutAmount` are `bigint`; `hash` is the transaction signature.

#### `options` (same shape for both methods)

| field | type | required | meaning |
|---|---|---|---|
| `tokenIn` | `string` | yes | mint of the token to sell |
| `tokenOut` | `string` | yes | mint of the token to buy |
| `tokenInAmount` | `number \| bigint` | conditional | exact input — a **SELL** (ExactIn) |
| `tokenOutAmount` | `number \| bigint` | conditional | exact output — a **BUY** (ExactOut) |
| `to` | `string` | no | recipient SPL **token account** for `tokenOut`; defaults to the account's own token account |

`tokenInAmount` and `tokenOutAmount` are mutually exclusive — provide exactly one:

- **SELL** (`tokenInAmount`) → ExactIn. Uses Jupiter **v2 `/build`** by default (or v1 when
  `apiVersion: 'v1'`).
- **BUY** (`tokenOutAmount`) → ExactOut. Always routes through Jupiter **v1**
  (`swapMode=ExactOut`), since v2 `/build` is ExactIn-only — see [Adapters](#adapters).

Providing neither throws `A swap requires either tokenInAmount (SELL) or tokenOutAmount (BUY).`

> `to` is passed straight to Jupiter as `destinationTokenAccount`, which expects a token
> account address (not an owner wallet address). Deriving the associated token account from
> an owner address is a planned enhancement; for now, pass the recipient's SPL token account
> for `tokenOut`.

## Configuration

`JupiterProtocolConfig` extends the WDK `SwapProtocolConfig` (whose only field is
`swapMaxFee`) with a documented Jupiter superset. Every field is optional.

| field | type | default | meaning |
|---|---|---|---|
| `swapMaxFee` | `number \| bigint` | _none_ | max fee (lamports) for a swap; the only field from the WDK contract. If `fee >= swapMaxFee`, `swap()` throws (see [Fee protection](#fee-protection)). |
| `slippageBps` | `number` | `50` | slippage tolerance in basis points (50 = 0.5%). |
| `apiVersion` | `'v2' \| 'v1'` | `'v2'` | adapter for SELL/ExactIn. `'v2'` = `/build`; `'v1'` = the fallback. BUY always uses v1 regardless. |
| `jupiterBaseUrl` | `string` | _host auto-selected_ | override the Jupiter host. Defaults to the keyless lite host, or the keyed host when `jupiterApiKey` is set. |
| `jupiterApiKey` | `string` | _none_ | API key for the keyed host (`api.jup.ag`). **Env-only — never hardcode** (e.g. `process.env.JUPITER_API_KEY`). |
| `timeoutMs` | `number` | `15000` | per-request timeout for Jupiter HTTP calls; a hung host aborts the `fetch` instead of stalling `swap()` / `quoteSwap()`. |
| `computeUnitLimit` | `number` | `1_400_000` | compute-unit limit prepended on v2 (`/build` omits the CU-limit instruction). |
| `computeUnitPricePercentile` | `number \| string` | _none_ | v2 priority-fee control (`'medium'` / `'high'` / `'veryHigh'`, or `0`–`10000` bps). |
| `dexes` | `string \| string[]` | _none_ | Jupiter-native route shaping: restrict routing to these DEX labels (e.g. `'Whirlpool'` or `['Whirlpool', 'Raydium']`). |
| `onlyDirectRoutes` | `boolean` | _none_ | Jupiter-native route shaping: force a single-hop route (no intermediate tokens). |

```js
// jupiterApiKey is read from the environment, never committed.
const protocol = new JupiterProtocolSolana(account, {
  slippageBps: 50,
  swapMaxFee: 50_000n,
  jupiterApiKey: process.env.JUPITER_API_KEY
})
```

When `jupiterApiKey` is set, requests go to the keyed host `https://api.jup.ag` with an
`x-api-key` header; otherwise they go to the keyless `https://lite-api.jup.ag`. An explicit
`jupiterBaseUrl` overrides both.

## Adapters

Both adapters return the same internal shape (`{ instructions, lookupTables, quote }`) so
the protocol code is identical regardless of which one runs.

- **v2 — `/swap/v2/build` (default).** One `GET` that returns the quote, the raw
  instructions, and the Address Lookup Tables **already inlined**
  (`addressesByLookupTableAddress`), so no RPC fetch is needed. v2 returns only the
  compute-unit *price* instruction, so the adapter **prepends a `SetComputeUnitLimit`**
  instruction (`computeUnitLimit`, default `1_400_000`). Used for SELL/ExactIn by default.
- **v1 — `/swap/v1/quote` + `/swap/v1/swap-instructions` (fallback).** Used when
  `apiVersion: 'v1'`, and always for **BUY** (`tokenOutAmount`), because v1 is the only path
  that supports `swapMode=ExactOut`. v1 emits its own CU-limit instruction (via
  `dynamicComputeUnitLimit`), so the adapter does **not** prepend one. v1 returns only the
  lookup-table *addresses*, so each table's contents are fetched from the account's RPC.

In both cases the wallet sets the transaction lifetime (blockhash) and fee payer itself —
the module hands it an unsigned `TransactionMessage` carrying just the compressed
instruction list.

## Fee protection

If `swapMaxFee` is set in the config, `swap()` quotes the transaction fee first and throws
before sending when the fee is too high:

```js
// from src/jupiter-protocol-solana.js
if (this._config.swapMaxFee !== undefined && fee >= this._config.swapMaxFee) {
  throw new Error('Exceeded maximum fee cost for swap operation.')
}
```

The error string is identical to the velora-evm peer's fee guard. `quoteSwap()` does not
enforce the cap — it only returns the fee so the caller can decide.

`swap()` also guards its preconditions, mirroring velora:

- a read-only account throws
  `The 'swap(options)' method requires the protocol to be initialized with a non read-only account.`
- no provider throws
  `The wallet must be connected to a provider in order to perform swap operations.`
  (`quoteSwap()` throws the `quote swap operations.` variant.)

## Testing

```sh
npm test
```

Unit tests cover the instruction mapping, both adapters, and the protocol surface (SELL/BUY
quote + swap, the fee guard, and the read-only / no-provider guards). They mock `fetch` and
the wallet account — no network or validator needed.

An end-to-end test (`tests/e2e/surfpool.e2e.test.js`) runs a **real** WSOL → USDT swap on a
[Surfpool](https://github.com/txtx/surfpool) mainnet fork and asserts the on-chain USDT
balance increased. It **auto-skips** when no Solana RPC answers on `SURFPOOL_RPC`
(default `http://127.0.0.1:8899`), so a plain `npm test` stays green without a validator.
See [`tests/e2e/README.md`](tests/e2e/README.md) for how to start Surfpool and run it.

## Phase-0 spikes

The two binary risks of a Jupiter-based Solana swap module — reaching Jupiter over TLS from
the Bare runtime, and composing a real Jupiter ALT/versioned route the validator accepts —
were retired up front with runnable spikes in [`spikes/phase-0/`](spikes/phase-0/) before
any module code was written. That directory is the de-risking evidence.

## License

Apache-2.0 © cryptoyasenka
