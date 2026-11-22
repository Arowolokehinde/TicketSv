import { Transaction, type WalletInterface } from '@bsv/sdk'
import { fromBase64 } from '../tickets/codec.ts'
import type { HeaderSnapshot } from '../headers/validate.ts'
import { requireMinedEvidence } from '../offline/attendee-evidence.ts'
import { listBasket } from '../wallet/ticket-record.ts'
import { waitImport } from '../wallet/mined-import.ts'
import { verifyHandoffTicket } from './evidence.ts'
import { readSettlement, settlementKey, type HandoffSettlement } from './settlement.ts'
import { createStore, readSender, sourceKey } from './store.ts'
import type { Attempt, HandoffTicket, RecordStore, SenderRecord } from './types.ts'
import { FUNDING_BASKET, checkHolder, keyMatches } from './wallet.ts'

// The handoff transfer is signed outside a wallet action, so the sender's wallet
// keeps listing its spent ticket and fee outputs. After the spend is verified
// mined, the sender may approve removing them from their baskets. Relinquishing
// stops the wallet tracking an output; it does not record a spend.
export type ReleaseBasket = 'ticketsv-tickets' | typeof FUNDING_BASKET
export type ReleaseObservation = { state: 'listed' | 'absent' | 'inconclusive'; checkedAt: string; reason: string }
export type OutputRelease = { basket: ReleaseBasket; outpoint: string; attempts: Attempt[]; observation?: ReleaseObservation }
export type SenderRelease = {
  kind: 'ticketsv-sender-release'
  version: 1
  id: string
  revision: number
  transferTxid: string
  verifiedAt: string
  snapshotId: string
  outputs: [OutputRelease, OutputRelease]
}
type Target<B extends ReleaseBasket> = { basket: B; outpoint: string }
export type ReleaseEligibility = {
  transferTxid: string
  snapshotId: string
  targets: [Target<'ticketsv-tickets'>, Target<typeof FUNDING_BASKET>]
}

const MAX_ATTEMPTS = 5
const BASKETS = ['ticketsv-tickets', FUNDING_BASKET] as const
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid sender release record.')
  return value as Record<string, unknown>
}
function date(value: unknown): string {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw Error('Invalid sender release date.')
  return value
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw Error('Invalid sender release record.')
  return value
}
function attempt(value: unknown): Attempt {
  const a = object(value)
  if (
    typeof a.id !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(a.id) ||
    !['pending', 'complete', 'unknown'].includes(a.outcome as string) ||
    (a.outcome === 'pending') !== (a.finishedAt === undefined)
  )
    throw Error('Invalid release attempt.')
  return {
    id: a.id,
    startedAt: date(a.startedAt),
    outcome: a.outcome as Attempt['outcome'],
    ...(a.finishedAt !== undefined ? { finishedAt: date(a.finishedAt) } : {}),
  }
}
function output(value: unknown, basket: ReleaseBasket): OutputRelease {
  const o = object(value)
  if (
    o.basket !== basket ||
    typeof o.outpoint !== 'string' ||
    !/^[0-9a-f]{64}\.(0|[1-9][0-9]{0,9})$/.test(o.outpoint) ||
    !Array.isArray(o.attempts) ||
    o.attempts.length > MAX_ATTEMPTS
  )
    throw Error('Invalid released output.')
  const attempts = o.attempts.map(attempt)
  if (attempts.slice(0, -1).some(a => a.outcome === 'pending')) throw Error('Only the latest release attempt may be pending.')
  const out: OutputRelease = { basket, outpoint: o.outpoint, attempts }
  if (o.observation !== undefined) {
    const v = object(o.observation)
    if (!['listed', 'absent', 'inconclusive'].includes(v.state as string)) throw Error('Invalid release observation.')
    out.observation = { state: v.state as ReleaseObservation['state'], checkedAt: date(v.checkedAt), reason: text(v.reason, 1000) }
  }
  return out
}
export function readSenderRelease(value: unknown, previous?: SenderRelease): SenderRelease {
  const v = object(value)
  if (
    v.kind !== 'ticketsv-sender-release' ||
    v.version !== 1 ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 0 ||
    typeof v.transferTxid !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.transferTxid) ||
    !Array.isArray(v.outputs) ||
    v.outputs.length !== 2
  )
    throw Error('Invalid sender release record.')
  const out: SenderRelease = {
    kind: 'ticketsv-sender-release',
    version: 1,
    id: text(v.id, 300),
    revision: v.revision as number,
    transferTxid: v.transferTxid,
    verifiedAt: date(v.verifiedAt),
    snapshotId: text(v.snapshotId, 200),
    outputs: [output(v.outputs[0], BASKETS[0]), output(v.outputs[1], BASKETS[1])],
  }
  if (previous) {
    const old = readSenderRelease(previous)
    for (const field of ['id', 'transferTxid', 'verifiedAt', 'snapshotId'] as const)
      if (old[field] !== out[field]) throw Error('A saved release cannot change its transfer.')
    old.outputs.forEach((before, index) => {
      const after = out.outputs[index]
      if (before.outpoint !== after.outpoint) throw Error('A saved release cannot change its outpoint.')
      if (after.attempts.length < before.attempts.length) throw Error('A release attempt cannot be removed.')
      before.attempts.forEach((a, i) => {
        const b = after.attempts[i]
        if (b.id !== a.id || b.startedAt !== a.startedAt || (a.outcome !== 'pending' && !same(a, b)))
          throw Error('A finished release attempt cannot be changed.')
      })
    })
  }
  return out
}
export const senderReleaseStore = createStore<SenderRelease>('sender-releases', readSenderRelease)

const transaction = (t: HandoffTicket) => Transaction.fromAtomicBEEF(fromBase64(t.pkg.atomicBeefBase64))
export function senderForSettlement(senders: SenderRecord[], settlement: HandoffSettlement): SenderRecord | undefined {
  return senders.find(s => s.transfer && settlementKey(s.transfer) === settlement.id)
}
export async function releaseEligibility(
  value: SenderRecord,
  settlement: HandoffSettlement | undefined,
  snapshot: HeaderSnapshot | undefined,
): Promise<ReleaseEligibility> {
  const sender = readSender(value),
    funding = sender.funding
  if (sender.signAttempt?.outcome !== 'complete' || !sender.transfer)
    throw Error('This ticket has no signed transfer saved on this device.')
  if (!funding?.txid || funding.index === undefined) throw Error('The saved fee output is missing.')
  if (!settlement) throw Error('Check the transfer status first.')
  const checked = readSettlement(settlement)
  if (checked.id !== settlementKey(sender.transfer) || transaction(checked.ticket).toHex() !== transaction(sender.transfer).toHex())
    throw Error('This saved transfer differs from the one signed on this device.')
  if (!snapshot) throw Error('Local headers are missing. Verify mining evidence first.')
  requireMinedEvidence(await verifyHandoffTicket(checked.ticket, snapshot))
  const tx = transaction(checked.ticket),
    ticket = `${sender.ticket.pkg.current.txid}.${sender.ticket.pkg.current.index}`,
    fee = `${funding.txid}.${funding.index}`
  const spent = tx.inputs.map(input => `${input.sourceTXID ?? input.sourceTransaction?.id('hex')}.${input.sourceOutputIndex}`)
  if (spent.length !== 2 || !spent.includes(ticket) || !spent.includes(fee))
    throw Error('The transfer does not spend exactly this ticket and its fee output.')
  return {
    transferTxid: tx.id('hex'),
    snapshotId: snapshot.id,
    targets: [
      { basket: 'ticketsv-tickets', outpoint: ticket },
      { basket: FUNDING_BASKET, outpoint: fee },
    ],
  }
}

async function observe(wallet: WalletInterface, target: OutputRelease, signal: AbortSignal): Promise<ReleaseObservation> {
  const checkedAt = new Date().toISOString()
  let outputs
  try {
    outputs = await listBasket(args => waitImport(() => wallet.listOutputs(args), signal), target.basket)
  } catch {
    signal.throwIfAborted()
    outputs = undefined
  }
  signal.throwIfAborted()
  if (!outputs) return { state: 'inconclusive', checkedAt, reason: 'Wallet records are incomplete. Recheck the wallet before releasing.' }
  return outputs.some(o => o.outpoint === target.outpoint)
    ? { state: 'listed', checkedAt, reason: 'This spent output is still listed in your wallet.' }
    : { state: 'absent', checkedAt, reason: 'This output is no longer listed in your wallet.' }
}
async function write(store: RecordStore<SenderRelease>, current: SenderRelease, outputs: SenderRelease['outputs']): Promise<SenderRelease> {
  const next = readSenderRelease({ ...current, outputs, revision: current.revision + 1 }, current)
  await store.save(next, current.revision)
  return next
}
function patch(record: SenderRelease, index: number, change: (o: OutputRelease) => OutputRelease): SenderRelease['outputs'] {
  const outputs = structuredClone(record.outputs)
  outputs[index] = change(outputs[index])
  return outputs
}
function guard(sender: SenderRecord, wallet: WalletInterface, signal: AbortSignal) {
  return async () => {
    await checkHolder(wallet, sender.ticket, signal)
    await keyMatches(wallet, sender.funding!.key, signal)
  }
}

export async function releaseSpentOutputs(
  value: SenderRecord,
  settlement: HandoffSettlement,
  wallet: WalletInterface,
  snapshot: HeaderSnapshot | undefined,
  signal: AbortSignal,
  store: RecordStore<SenderRelease> = senderReleaseStore,
): Promise<SenderRelease> {
  const sender = readSender(value),
    eligible = await releaseEligibility(sender, settlement, snapshot),
    id = sourceKey(sender.ticket),
    fresh = guard(sender, wallet, signal)
  let record = await store.load(id)
  if (!record) {
    record = readSenderRelease({
      kind: 'ticketsv-sender-release',
      version: 1,
      id,
      revision: 0,
      transferTxid: eligible.transferTxid,
      verifiedAt: new Date().toISOString(),
      snapshotId: eligible.snapshotId,
      outputs: eligible.targets.map(t => ({ ...t, attempts: [] })),
    })
    await store.save(record, undefined)
  } else if (
    record.transferTxid !== eligible.transferTxid ||
    !same(
      record.outputs.map(o => [o.basket, o.outpoint]),
      eligible.targets.map(t => [t.basket, t.outpoint]),
    )
  )
    throw Error('The saved release belongs to a different transfer.')
  // Ticket first, then fee. Each press observes first, so an attempt is only made
  // against a fresh "still listed" observation. Nothing is retried automatically.
  for (let index = 0; index < 2; index++) {
    await fresh()
    const seen = await observe(wallet, record.outputs[index], signal)
    record = await write(
      store,
      record,
      patch(record, index, o => ({ ...o, observation: seen })),
    )
    if (seen.state === 'absent') continue
    if (seen.state === 'inconclusive') throw Error('Wallet records are inconclusive. Recheck the wallet before releasing.')
    const target = record.outputs[index]
    if (target.attempts.at(-1)?.outcome === 'pending') throw Error('An earlier release outcome is unknown. Recheck the wallet first.')
    if (target.attempts.length >= MAX_ATTEMPTS)
      throw Error('The release attempt limit is reached for this output. Review the wallet directly.')
    signal.throwIfAborted()
    const claim: Attempt = { id: crypto.randomUUID(), outcome: 'pending', startedAt: new Date().toISOString() }
    record = await write(
      store,
      record,
      patch(record, index, o => ({ ...o, attempts: [...o.attempts, claim] })),
    )
    let outcome: Attempt['outcome'] = 'unknown'
    try {
      await fresh()
      const response = await waitImport(() => {
        signal.throwIfAborted()
        return wallet.relinquishOutput({ basket: target.basket, output: target.outpoint })
      }, signal)
      if (response?.relinquished === true) outcome = 'complete'
    } catch {
      /* Declined, unsupported, cancelled or lost: saved as unknown, never retried here. */
    }
    const finishedAt = new Date().toISOString()
    record = await write(
      store,
      record,
      patch(record, index, o => ({ ...o, attempts: o.attempts.map(a => (a.id === claim.id ? { ...a, outcome, finishedAt } : a)) })),
    )
    if (signal.aborted) return record
    const after = await observe(wallet, record.outputs[index], signal)
    record = await write(
      store,
      record,
      patch(record, index, o => ({ ...o, observation: after })),
    )
    if (after.state !== 'absent') return record
  }
  await fresh()
  return record
}

// Read-only. A pending claim left by a closed tab can no longer be completed by
// that tab, so it is saved as unknown before the wallet is observed again.
export async function recheckRelease(
  value: SenderRecord,
  wallet: WalletInterface,
  signal: AbortSignal,
  store: RecordStore<SenderRelease> = senderReleaseStore,
): Promise<SenderRelease | undefined> {
  const sender = readSender(value),
    fresh = guard(sender, wallet, signal)
  let record = await store.load(sourceKey(sender.ticket))
  if (!record) return undefined
  const finishedAt = new Date().toISOString()
  if (record.outputs.some(o => o.attempts.at(-1)?.outcome === 'pending'))
    record = await write(
      store,
      record,
      record.outputs.map(o => ({
        ...o,
        attempts: o.attempts.map(a => (a.outcome === 'pending' ? { ...a, outcome: 'unknown', finishedAt } : a)),
      })) as SenderRelease['outputs'],
    )
  await fresh()
  for (let index = 0; index < 2; index++) {
    const seen = await observe(wallet, record.outputs[index], signal)
    record = await write(
      store,
      record,
      patch(record, index, o => ({ ...o, observation: seen })),
    )
  }
  await fresh()
  return record
}
