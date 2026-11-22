import { Beef } from '@bsv/sdk'
import { fromBase64 } from './codec.ts'
import type { TicketPackage } from './types.ts'

// What a ticket carries as evidence. Once a transfer is mined, its BEEF needs
// only the transaction and one mining proof, not the ancestors it spent.
export type EvidenceSize = { bytes: number; transactions: number; proofs: number }
export function evidenceSize(pkg: TicketPackage): EvidenceSize {
  const bytes = fromBase64(pkg.atomicBeefBase64),
    beef = Beef.fromBinary(bytes)
  return { bytes: bytes.length, transactions: beef.txs.length, proofs: beef.bumps.length }
}
export function readEvidenceSize(value: unknown): EvidenceSize {
  const v = value as EvidenceSize,
    count = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0
  if (!v || !count(v.bytes) || v.bytes < 1 || !count(v.transactions) || v.transactions < 1 || !count(v.proofs))
    throw Error('Invalid saved evidence size.')
  return { bytes: v.bytes, transactions: v.transactions, proofs: v.proofs }
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
export function formatEvidence(s: EvidenceSize): string {
  return `${(s.bytes / 1024).toFixed(1)} KB · ${plural(s.transactions, 'transaction')} · ${s.proofs ? plural(s.proofs, 'mining proof') : 'no mining proof'}`
}
export function evidenceChange(before: EvidenceSize | undefined, after: EvidenceSize): string {
  if (!before) return `Ticket evidence: ${formatEvidence(after)}.`
  return `Ticket evidence: ${formatEvidence(before)} → ${formatEvidence(after)} after mining. Earlier history is replaced by one mining proof.`
}
