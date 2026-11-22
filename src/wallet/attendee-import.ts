import { inspectTicketWalletRecord } from './ticket-record.ts'
import { Transaction } from '@bsv/sdk'
import type { WalletInterface, InternalizeActionArgs } from '@bsv/sdk'
import { readAttendeeEvidence, verifyAttendeeEvidence, requireMinedEvidence, type AttendeeEvidence } from '../offline/attendee-evidence.ts'
import { fromBase64 } from '../tickets/codec.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import type { ImportReview } from './import-review.ts'
import { waitImport } from './mined-import.ts'
import { attendeeImportStore, importFingerprint, type AttendeeImportRecord } from './attendee-import-store.ts'
import { checkWallet } from './identity.ts'

type AttendeeWallet = Pick<WalletInterface, 'getNetwork' | 'getVersion' | 'getPublicKey' | 'listOutputs' | 'internalizeAction'>
export type AttendeeImportReview = { evidence: AttendeeEvidence; fingerprint: string; wallet: ImportReview }
export type AttendeeImportDependencies = {
  source: () => Promise<{ evidence: AttendeeEvidence; snapshot: HeaderSnapshot | undefined }>
  wallet: (signal: AbortSignal) => Promise<AttendeeWallet>
  store: typeof attendeeImportStore
  guard: () => void
}
function check(signal: AbortSignal, deps: AttendeeImportDependencies) {
  signal.throwIfAborted()
  deps.guard()
}
async function read<T>(work: () => Promise<T>, signal: AbortSignal, deps: AttendeeImportDependencies): Promise<T> {
  check(signal, deps)
  const result = await waitImport(() => {
    check(signal, deps)
    return work()
  }, signal)
  check(signal, deps)
  return result
}
async function identity(client: AttendeeWallet, e: AttendeeEvidence, signal: AbortSignal, deps: AttendeeImportDependencies) {
  await checkWallet(
    client,
    {
      identity: e.attendee,
      receivingKey: e.proof.request.recipient,
      messages: {
        network: 'Select testnet in your wallet.',
        identity: 'Wallet identity does not match this attendee account.',
        receivingKey: 'Wallet receiving key does not match this ticket.',
      },
    },
    (_method, work) => read(work, signal, deps),
  )
}
async function source(signal: AbortSignal, deps: AttendeeImportDependencies, expected?: { fingerprint: string; snapshotId?: string }) {
  const state = await read(deps.source, signal, deps)
  const evidence = readAttendeeEvidence(state.evidence, state.evidence.origin),
    fingerprint = importFingerprint(evidence)
  if (
    expected &&
    (expected.fingerprint !== fingerprint || (expected.snapshotId !== undefined && state.snapshot?.id !== expected.snapshotId))
  )
    throw Error('Ticket evidence or headers changed. Check wallet readiness again.')
  return { ...state, evidence, fingerprint }
}
async function inspect(signal: AbortSignal, deps: AttendeeImportDependencies, expected?: AttendeeImportReview) {
  const state = await source(signal, deps, expected && { fingerprint: expected.fingerprint, snapshotId: expected.wallet.snapshotId })
  const verified = await verifyAttendeeEvidence(state.evidence, state.evidence.origin, state.snapshot)
  requireMinedEvidence(verified)
  if (!verified.snapshotId) throw Error('A verified local header snapshot is required.')
  check(signal, deps)
  const client = await read(() => deps.wallet(signal), signal, deps),
    e = state.evidence
  await identity(client, e, signal, deps)
  const version = (await read(() => client.getVersion({}), signal, deps)).version
  if (typeof version !== 'string' || version.length < 1 || version.length > 100) throw Error('Invalid wallet interface version.')
  const output = Transaction.fromAtomicBEEF(fromBase64(e.pkg.atomicBeefBase64)).outputs[e.pkg.current.index]
  const observation = await inspectTicketWalletRecord(args => read(() => client.listOutputs(args), signal, deps), {
    outpoint: `${e.pkg.current.txid}.${e.pkg.current.index}`,
    satoshis: output.satoshis!,
    lockingScript: output.lockingScript.toHex(),
    key: e.proof.request.recipient,
  })
  await identity(client, e, signal, deps)
  await source(signal, deps, { fingerprint: state.fingerprint, snapshotId: verified.snapshotId })
  const wallet: ImportReview = {
    ...observation,
    outpoint: `${e.pkg.current.txid}.${e.pkg.current.index}`,
    walletIdentity: e.attendee,
    walletVersion: version,
    requestId: e.proof.request.requestId,
    snapshotId: verified.snapshotId,
    checkedAt: new Date().toISOString(),
  }
  return { evidence: e, fingerprint: state.fingerprint, wallet, client }
}
export async function reviewAttendeeImport(signal: AbortSignal, deps: AttendeeImportDependencies): Promise<AttendeeImportReview> {
  const { client: _client, ...review } = await inspect(signal, deps)
  return review
}
export async function importAttendeeTicket(
  review: AttendeeImportReview,
  signal: AbortSignal,
  deps: AttendeeImportDependencies,
): Promise<AttendeeImportRecord> {
  if (await read(() => deps.store.load(review.evidence), signal, deps))
    throw Error('A wallet import was already attempted. Reconcile without retrying.')
  if (review.wallet.state !== 'absent') throw Error('Import requires an absent ticket in a complete wallet listing.')
  const current = await inspect(signal, deps, review)
  if (current.wallet.state !== 'absent') throw Error('Import requires an absent ticket. Review the current wallet record.')
  const e = current.evidence,
    key = e.proof.request.recipient
  const args: InternalizeActionArgs = {
    tx: fromBase64(e.pkg.atomicBeefBase64),
    outputs: [
      {
        outputIndex: e.pkg.current.index,
        protocol: 'basket insertion',
        insertionRemittance: {
          basket: 'ticketsv-tickets',
          customInstructions: JSON.stringify({
            protocolID: key.protocolID,
            keyID: key.keyID,
            counterparty: key.counterparty,
            type: 'PushDrop',
          }),
        },
      },
    ],
    description: 'Add mined TicketSV attendee ticket to wallet',
    seekPermission: true,
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
  } catch {
    /* The wallet may have processed the action. Keep duplicate protection. */
  }
  // Persist the receipt even if the UI is gone. A failed write retains pending.
  return deps.store.finish(e, claimed.attempt.id, outcome)
}
export async function reconcileAttendeeImport(signal: AbortSignal, deps: AttendeeImportDependencies): Promise<AttendeeImportRecord> {
  const state = await source(signal, deps),
    saved = await read(() => deps.store.load(state.evidence), signal, deps)
  if (!saved) throw Error('There is no saved import attempt to reconcile.')
  if (saved.fingerprint !== state.fingerprint) throw Error('Saved import evidence changed. Review the existing record; do not retry.')
  const review = await inspect(signal, deps)
  if (review.fingerprint !== saved.fingerprint) throw Error('Ticket evidence changed during reconciliation.')
  check(signal, deps)
  return deps.store.observe(review.evidence, saved.attempt.id, review.wallet)
}
