import { Transaction } from '@bsv/sdk'
import type { WalletInterface, InternalizeActionArgs } from '@bsv/sdk'
import { readAttendeeEvidence, verifyAttendeeEvidence, requireMinedEvidence, type AttendeeEvidence } from '../offline/attendee-evidence.ts'
import { fromBase64 } from '../tickets/codec.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import type { ImportReview } from './import-review.ts'
import { waitImport } from './mined-import.ts'
import { attendeeImportStore, importFingerprint, type AttendeeImportRecord } from './attendee-import-store.ts'

type AttendeeWallet = Pick<WalletInterface, 'getNetwork' | 'getVersion' | 'getPublicKey' | 'listOutputs' | 'internalizeAction'>
export type AttendeeImportReview = { evidence: AttendeeEvidence; fingerprint: string; wallet: ImportReview }
export type AttendeeImportDependencies = {
 source: () => Promise<{ evidence: AttendeeEvidence; snapshot: HeaderSnapshot | undefined }>
 wallet: (signal: AbortSignal) => Promise<AttendeeWallet>
 store: typeof attendeeImportStore
 guard: () => void
}
function check(signal: AbortSignal, deps: AttendeeImportDependencies) { signal.throwIfAborted(); deps.guard() }
async function read<T>(work: () => Promise<T>, signal: AbortSignal, deps: AttendeeImportDependencies): Promise<T> {
 check(signal, deps)
 const result = await waitImport(() => { check(signal, deps); return work() }, signal)
 check(signal, deps); return result
}
async function identity(client: AttendeeWallet, e: AttendeeEvidence, signal: AbortSignal, deps: AttendeeImportDependencies) {
 if ((await read(() => client.getNetwork({}), signal, deps)).network !== 'testnet') throw Error('Select testnet in your wallet.')
 if ((await read(() => client.getPublicKey({ identityKey: true }), signal, deps)).publicKey !== e.attendee) throw Error('Wallet identity does not match this attendee account.')
 const key = e.proof.request.recipient
 if ((await read(() => client.getPublicKey({ protocolID: key.protocolID, keyID: key.keyID, counterparty: key.counterparty, forSelf: true }), signal, deps)).publicKey !== key.publicKey) throw Error('Wallet receiving key does not match this ticket.')
}
async function source(signal: AbortSignal, deps: AttendeeImportDependencies, expected?: { fingerprint: string; snapshotId?: string }) {
 const state = await read(deps.source, signal, deps)
 const evidence = readAttendeeEvidence(state.evidence, state.evidence.origin), fingerprint = importFingerprint(evidence)
 if (expected && (expected.fingerprint !== fingerprint || expected.snapshotId !== undefined && state.snapshot?.id !== expected.snapshotId)) throw Error('Ticket evidence or headers changed. Check wallet readiness again.')
 return { ...state, evidence, fingerprint }
}
async function inspect(signal: AbortSignal, deps: AttendeeImportDependencies, expected?: AttendeeImportReview) {
 const state = await source(signal, deps, expected && { fingerprint: expected.fingerprint, snapshotId: expected.wallet.snapshotId })
 const verified = await verifyAttendeeEvidence(state.evidence, state.evidence.origin, state.snapshot)
 requireMinedEvidence(verified)
 if (!verified.snapshotId) throw Error('A verified local header snapshot is required.')
 check(signal, deps)
 const client = await read(() => deps.wallet(signal), signal, deps), e = state.evidence
 await identity(client, e, signal, deps)
 const version = (await read(() => client.getVersion({}), signal, deps)).version
 if (typeof version !== 'string' || version.length < 1 || version.length > 100) throw Error('Invalid wallet interface version.')
 const listing = await read(() => client.listOutputs({ basket: 'ticketsv-tickets', include: 'locking scripts', includeCustomInstructions: true, limit: 1000 }), signal, deps)
 await identity(client, e, signal, deps)
 await source(signal, deps, { fingerprint: state.fingerprint, snapshotId: verified.snapshotId })
 const base = { outpoint: `${e.pkg.current.txid}.${e.pkg.current.index}`, walletIdentity: e.attendee, walletVersion: version, requestId: e.proof.request.requestId, snapshotId: verified.snapshotId, checkedAt: new Date().toISOString() }
 let wallet: ImportReview = { ...base, state: 'inconclusive', reason: 'The wallet listing is incomplete or inconsistent. Review wallet records before importing.' }
 if (listing && Number.isSafeInteger(listing.totalOutputs) && listing.totalOutputs >= 0 && listing.totalOutputs <= 1000 && Array.isArray(listing.outputs) && listing.outputs.length === listing.totalOutputs) {
  const seen = new Set<string>()
  const valid = listing.outputs.every(o => {
   if (!o || typeof o.outpoint !== 'string' || !/^[0-9a-f]{64}\.(0|[1-9][0-9]{0,9})$/.test(o.outpoint) || Number(o.outpoint.split('.')[1]) > 0xffffffff || seen.has(o.outpoint) || !Number.isSafeInteger(o.satoshis) || o.satoshis < 0 || typeof o.spendable !== 'boolean' || typeof o.lockingScript !== 'string' || o.lockingScript.length > 8 * 1024 * 1024 || !/^(?:[0-9a-fA-F]{2})*$/.test(o.lockingScript)) return false
   seen.add(o.outpoint); return true
  })
  if (valid) {
   const match = listing.outputs.find(o => o.outpoint === base.outpoint)
   if (!match) wallet = { ...base, state: 'absent', reason: 'This ticket was not found in the TicketSV wallet basket. Other wallet records may still exist.' }
   else {
    const output = Transaction.fromAtomicBEEF(fromBase64(e.pkg.atomicBeefBase64)).outputs[e.pkg.current.index], key = e.proof.request.recipient
    try {
     if (!output || match.spendable !== true || match.satoshis !== output.satoshis || match.lockingScript !== output.lockingScript.toHex() || typeof match.customInstructions !== 'string' || match.customInstructions.length > 10000) throw Error('Mismatch')
     const instructions = JSON.parse(match.customInstructions)
     if (!instructions || instructions.type !== 'PushDrop' || instructions.keyID !== key.keyID || instructions.counterparty !== key.counterparty || JSON.stringify(instructions.protocolID) !== JSON.stringify(key.protocolID)) throw Error('Mismatch')
     wallet = { ...base, state: 'present', reason: 'A matching ticket output and receiving-key instructions are recorded in your wallet. This does not establish current chain unspentness.' }
    } catch { wallet = { ...base, state: 'inconclusive', reason: 'The wallet ticket amount, script, spendable report or receiving-key instructions differ. Review wallet records before importing.' } }
   }
  }
 }
 return { evidence: e, fingerprint: state.fingerprint, wallet, client }
}
export async function reviewAttendeeImport(signal: AbortSignal, deps: AttendeeImportDependencies): Promise<AttendeeImportReview> {
 const { client: _client, ...review } = await inspect(signal, deps)
 return review
}
export async function importAttendeeTicket(review: AttendeeImportReview, signal: AbortSignal, deps: AttendeeImportDependencies): Promise<AttendeeImportRecord> {
 if (await read(() => deps.store.load(review.evidence), signal, deps)) throw Error('A wallet import was already attempted. Reconcile without retrying.')
 if (review.wallet.state !== 'absent') throw Error('Import requires an absent ticket in a complete wallet listing.')
 const current = await inspect(signal, deps, review)
 if (current.wallet.state !== 'absent') throw Error('Import requires an absent ticket. Review the current wallet record.')
 const e = current.evidence, key = e.proof.request.recipient
 const args: InternalizeActionArgs = {
  tx: fromBase64(e.pkg.atomicBeefBase64), outputs: [{ outputIndex: e.pkg.current.index, protocol: 'basket insertion', insertionRemittance: { basket: 'ticketsv-tickets', customInstructions: JSON.stringify({ protocolID: key.protocolID, keyID: key.keyID, counterparty: key.counterparty, type: 'PushDrop' }) } }],
  description: 'Add mined TicketSV attendee ticket to wallet', seekPermission: true,
 }
 check(signal, deps)
 // Do not race the durable claim against cancellation: dispatch is checked AFTER
 // persistence completes. Unknown/pending outcomes are never cleared or retried.
 const claimed = await deps.store.claim(e)
 let outcome: 'accepted' | 'unknown' = 'unknown'
 try {
  await source(signal, deps, { fingerprint: current.fingerprint, snapshotId: current.wallet.snapshotId })
  await identity(current.client, e, signal, deps)
  await source(signal, deps, { fingerprint: current.fingerprint, snapshotId: current.wallet.snapshotId })
  const response = await read(() => current.client.internalizeAction(args), signal, deps)
  await identity(current.client, e, signal, deps)
  if (response?.accepted === true) outcome = 'accepted'
 } catch { /* The wallet may have processed the action. Keep duplicate protection. */ }
 // Persist the receipt even if the UI is gone. A failed write retains pending.
 return deps.store.finish(e, claimed.attempt.id, outcome)
}
export async function reconcileAttendeeImport(signal: AbortSignal, deps: AttendeeImportDependencies): Promise<AttendeeImportRecord> {
 const state = await source(signal, deps), saved = await read(() => deps.store.load(state.evidence), signal, deps)
 if (!saved) throw Error('There is no saved import attempt to reconcile.')
 if (saved.fingerprint !== state.fingerprint) throw Error('Saved import evidence changed. Review the existing record; do not retry.')
 const review = await inspect(signal, deps)
 if (review.fingerprint !== saved.fingerprint) throw Error('Ticket evidence changed during reconciliation.')
 check(signal, deps)
 return deps.store.observe(review.evidence, saved.attempt.id, review.wallet)
}
