// Strict-consumer type-check (CI guard, not shipped).
// Compiles a realistic downstream consumer against the PUBLISHED types in `types/`.
// Guards the published declaration surface: `JupiterProtocolSolana` must be
// constructable and expose concrete `quoteSwap` / `swap` (regression guard for the
// abstract-override that tsc's declaration emit silently drops).
import JupiterProtocolSolana from 'wdk-protocol-swap-jupiter-solana'
import type { SwapResult } from 'wdk-protocol-swap-jupiter-solana'

declare const account: any

const protocol = new JupiterProtocolSolana(account, { slippageBps: 50, apiVersion: 'v2' })

export async function run (): Promise<void> {
  const quote = await protocol.quoteSwap({ tokenIn: 'A', tokenOut: 'B', tokenInAmount: 1_000_000n })
  const result: SwapResult = await protocol.swap({ tokenIn: 'A', tokenOut: 'B', tokenInAmount: 1_000_000n })
  // touch the result shapes so an unused-var rule can't mask a missing member
  void quote.fee
  void result.hash
}
