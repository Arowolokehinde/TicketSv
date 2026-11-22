import { verifyMinedCandidate } from '../settlement/evidence.ts'
import type { ArcObservation } from '../settlement/types.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import type { Admission, DoorCopy, Reconcile } from './admissions.ts'

// Back online, the door works out which copy of each admitted ticket is mined.
// A copy counts as mined only when ARC's proof checks out against this device's
// headers; a provider's word alone never confirms or condemns an admission.
type Deps = { status: (txid: string, signal: AbortSignal) => Promise<ArcObservation | undefined>; snapshot: HeaderSnapshot | undefined }

async function provenMined(copy: DoorCopy, trusted: string, deps: Deps, signal: AbortSignal): Promise<boolean> {
  const observation = await deps.status(copy.txid, signal)
  signal.throwIfAborted()
  if (!observation || !['MINED', 'IMMUTABLE'].includes(observation.txStatus)) return false
  try {
    const evidence = {
      kind: 'counterfoil-reopening-evidence' as const,
      version: 1 as const,
      trusted,
      buyer: copy.pkg.request,
      pkg: copy.pkg,
    }
    const verification = await verifyMinedCandidate(evidence, observation, deps.snapshot)
    return verification.verdict === 'verified' && verification.presentedTransferMined
  } catch {
    return false
  }
}

export async function reconcileAdmission(
  record: Admission,
  trusted: string,
  deps: Deps,
  signal: AbortSignal,
  now: string,
): Promise<Admission> {
  let result: Omit<Reconcile, 'checkedAt'>
  try {
    if (await provenMined(record.admitted, trusted, deps, signal))
      result = { state: 'confirmed', reason: "The admitted copy is mined, checked against this device's headers." }
    else {
      let winner: string | undefined
      for (const copy of record.refused) if (!winner && (await provenMined(copy, trusted, deps, signal))) winner = copy.txid
      result = winner
        ? { state: 'lost', winnerTxid: winner, reason: "Another copy of this ticket is mined, checked against this device's headers." }
        : { state: 'waiting', reason: 'No copy is proven mined yet. Check again later.' }
    }
  } catch (error) {
    signal.throwIfAborted()
    result = {
      state: 'unknown',
      reason: `Mining status could not be checked (${error instanceof Error ? error.message : 'network error'}). Check again later.`,
    }
  }
  return { ...record, revision: record.revision + 1, reconcile: { ...result, checkedAt: now } }
}
