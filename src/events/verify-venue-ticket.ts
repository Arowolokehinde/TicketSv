import { fromBase64 } from '../tickets/codec.ts'
import type { ReceiveRequest, TicketPackage, Verification } from '../tickets/types.ts'
import { loadSnapshot, saveSnapshot, type SnapshotExpectation } from '../headers/store.ts'
import { pacedHeaderFetcher, syncHeaders, type HeaderFetcher, type HeaderSyncProgress } from '../headers/sync.ts'
import { SHARED_HEADERS_ENABLED, syncCachedHeaders } from '../headers/cached-sync.ts'
import { CHECKPOINT } from '../headers/checkpoint.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import { readSigningEvidenceBytes } from '../verification/signing-spv.ts'
import { verifyTicket } from '../verification/verifyTicket.ts'

// Header preparation may contact public sources. The verifier itself stays local.
export async function verifyVenueTicket(pkg: TicketPackage, options: {
 trustedVenueIdentity: string
 expectedRequest: ReceiveRequest
 online: boolean
 signal: AbortSignal
 onProgress?: (progress: HeaderSyncProgress) => void
 getHeader?: HeaderFetcher
}): Promise<Verification> {
 const { signal } = options
 signal.throwIfAborted()
 let snapshot = await loadSnapshot()
 const verify = async () => {
  signal.throwIfAborted()
  const result = await verifyTicket(pkg, { trustedVenueIdentity: options.trustedVenueIdentity, expectedRequest: options.expectedRequest, snapshot })
  signal.throwIfAborted()
  return result
 }
 const initial = await verify()
 // Never fetch for rejected evidence, missing recipient context, or an offline device.
 if (!options.online || initial.verdict !== 'incomplete' || !initial.checks.some(c => c.name === 'anchors' && c.status === 'incomplete')) return initial
 const evidence = readSigningEvidenceBytes(pkg.current.txid, fromBase64(pkg.atomicBeefBase64))
 if (evidence.anchors.some(height => height < CHECKPOINT.height)) throw Error('This ticket predates the supported header checkpoint. Header coverage needs review.')
 let expected: SnapshotExpectation = { id: snapshot?.id }
 const persist = async (next: HeaderSnapshot) => {
  signal.throwIfAborted()
  await saveSnapshot(next, signal, expected)
  expected = { id: next.id }
 }
 if (options.getHeader || !SHARED_HEADERS_ENABLED) {
  const result = await syncHeaders(evidence.requiredHeight, snapshot, options.getHeader ?? pacedHeaderFetcher(() => {}), signal, options.onProgress, { onCheckpoint: persist })
  await persist(result.snapshot)
 } else await syncCachedHeaders(evidence.requiredHeight, snapshot, signal, options.onProgress, persist)
 // Re-read the persisted snapshot, including any newer successful save from another tab.
 snapshot = await loadSnapshot()
 return verify()
}
