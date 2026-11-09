import { Transaction } from '@bsv/sdk'
import { fromBase64 } from '../tickets/codec.ts'
import type { TicketPackage } from '../tickets/types.ts'
// Server evidence wins unless the journal can recover a missing first package
// or a mining proof not yet saved there. Never downgrade a saved mining proof.
export function recoveryCandidate(saved: TicketPackage | null | undefined, local: TicketPackage | undefined): TicketPackage | undefined {
 if (!local) return undefined
 if (!saved) return local
 if (saved.current.txid !== local.current.txid || saved.lineageRawTxs[0] !== local.lineageRawTxs[0]) return undefined
 try {
  if (!Transaction.fromAtomicBEEF(fromBase64(saved.atomicBeefBase64)).merklePath && Transaction.fromAtomicBEEF(fromBase64(local.atomicBeefBase64)).merklePath) return local
 } catch { /* A malformed recovery copy never replaces saved evidence. */ }
 return undefined
}
