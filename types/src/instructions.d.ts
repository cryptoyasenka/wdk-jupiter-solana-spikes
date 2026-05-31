/**
 * @typedef {Object} JupiterAccountMeta
 * @property {string} pubkey - base58 account address.
 * @property {boolean} isSigner - whether the account signs the transaction.
 * @property {boolean} isWritable - whether the account is written to.
 */
/**
 * @typedef {Object} JupiterInstruction
 * @property {string} programId - base58 program address.
 * @property {JupiterAccountMeta[]} accounts - the instruction's account metas.
 * @property {string} data - base64-encoded instruction data.
 */
/**
 * Map a Jupiter `AccountMeta` (`isSigner`/`isWritable` booleans) to a kit `AccountRole`.
 * Lifted verbatim from the Phase-0 spike (proven against live mainnet).
 *
 * @param {JupiterAccountMeta} m
 * @returns {AccountRole}
 */
export function toRole(m: JupiterAccountMeta): AccountRole;
/**
 * Map a raw Jupiter instruction (v1 `/swap-instructions` or v2 `/build`, identical shape)
 * to a `@solana/transaction-messages` instruction. Lifted verbatim from the Phase-0 spike.
 *
 * @param {JupiterInstruction} ix
 * @returns {{ programAddress: import('@solana/addresses').Address, accounts: Array<{ address: import('@solana/addresses').Address, role: AccountRole }>, data: Uint8Array }}
 */
export function toKitInstruction(ix: JupiterInstruction): {
    programAddress: import("@solana/addresses").Address;
    accounts: Array<{
        address: import("@solana/addresses").Address;
        role: AccountRole;
    }>;
    data: Uint8Array;
};
/**
 * Build a raw `SetComputeUnitLimit` ComputeBudget instruction in the Jupiter wire shape
 * (so it flows through {@link toKitInstruction} unchanged). v2 `/build` returns only the
 * CU-*price* instruction (no limit), so the v2 adapter must prepend this one.
 * Encoding: discriminator `0x02` + `u32` little-endian `units`.
 *
 * @param {number} units - compute-unit limit (1..1_400_000).
 * @returns {JupiterInstruction}
 */
export function setComputeUnitLimitInstruction(units: number): JupiterInstruction;
export type JupiterAccountMeta = {
    /**
     * - base58 account address.
     */
    pubkey: string;
    /**
     * - whether the account signs the transaction.
     */
    isSigner: boolean;
    /**
     * - whether the account is written to.
     */
    isWritable: boolean;
};
export type JupiterInstruction = {
    /**
     * - base58 program address.
     */
    programId: string;
    /**
     * - the instruction's account metas.
     */
    accounts: JupiterAccountMeta[];
    /**
     * - base64-encoded instruction data.
     */
    data: string;
};
import { AccountRole } from '@solana/instructions';
