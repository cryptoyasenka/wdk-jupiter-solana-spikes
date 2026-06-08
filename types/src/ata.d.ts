/**
 * Derive an owner's Associated Token Account (ATA) for a mint under the classic SPL
 * Token program. Pure PDA derivation — no RPC. NOTE: classic SPL only; Token-2022 mints
 * (owned by `TOKEN_2022_PROGRAM_ADDRESS`) would derive under a different token program,
 * which can't be detected without an on-chain account read — out of scope here.
 *
 * @param {import('@solana/addresses').Address} owner - owner wallet address.
 * @param {import('@solana/addresses').Address} mint - token mint.
 * @returns {Promise<import('@solana/addresses').Address>} the derived classic-SPL ATA.
 */
export function deriveAta(owner: import("@solana/addresses").Address, mint: import("@solana/addresses").Address): Promise<import("@solana/addresses").Address>;
/**
 * Build a `createAssociatedTokenAccountIdempotent` instruction (already kit-shaped — it goes
 * straight into the kit instruction list, NOT through `toKitInstruction`). Idempotent: a no-op
 * if `ata` already exists. The `payer` funds the account's ~0.002 SOL rent. Classic SPL only
 * (the instruction defaults `tokenProgram` to `TOKEN_PROGRAM_ADDRESS`).
 *
 * @param {object} params
 * @param {import('@solana/addresses').Address} params.payer - rent payer (the swap taker / fee payer).
 * @param {import('@solana/addresses').Address} params.ata - the ATA to create (from {@link deriveAta}).
 * @param {import('@solana/addresses').Address} params.owner - owner wallet address.
 * @param {import('@solana/addresses').Address} params.mint - token mint.
 * @returns {{ programAddress: import('@solana/addresses').Address, accounts: Array<{ address: import('@solana/addresses').Address, role: number }>, data: Uint8Array }}
 */
export function createAtaIdempotentIx({ payer, ata, owner, mint }: {
    payer: import("@solana/addresses").Address;
    ata: import("@solana/addresses").Address;
    owner: import("@solana/addresses").Address;
    mint: import("@solana/addresses").Address;
}): {
    programAddress: import("@solana/addresses").Address;
    accounts: Array<{
        address: import("@solana/addresses").Address;
        role: number;
    }>;
    data: Uint8Array;
};
