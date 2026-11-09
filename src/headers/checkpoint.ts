// Both providers agreed on this testnet checkpoint on 2026-10-23.
// A trust anchor for the bounded experiment, not independently proven best-chain consensus.
export const CHECKPOINT = Object.freeze({ height: 1762324, hash: '00000000077273c54c7ef1702e329e7bab4d6bc924f7715b75a2816f9fd3d747' })
// Work budget per queued operation, renewable from the saved tip.
export const HEADER_COLLECTION_WINDOW = 4096
// Heights fit the backend PostgreSQL integer and all range arithmetic stays exact.
export function validHeaderHeight(height: number): boolean {
 return Number.isSafeInteger(height) && height >= CHECKPOINT.height && height <= 0x7fffffff
}
export const HEADER_TRUST = 'Checkpoint, linkage and declared-target proof of work checked. Source comparison may be performed by the TicketSV cache server. Full difficulty adjustment and best-chain selection are not checked.'
