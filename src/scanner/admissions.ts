import { createStore } from '../handoff/store.ts'
import { normalizeScannerTicket, type scannerPolicy } from './verify.ts'
import type { TicketPackage } from '../tickets/types.ts'
import { outpoint, type SpentList } from './spent.ts'

// The door's memory, kept only on this device. A ticket is identified by its
// event and original issuance, which every transfer and both copies of a
// double sale share: the first mined copy is admitted, any later copy refused.
// Offline cannot catch a double sale, so an unmined transfer is never admitted.
// A mined copy whose output has since been spent was passed on, so it is refused
// too, and a copy the door cannot check is refused rather than risked.
type Policy = ReturnType<typeof scannerPolicy>
export type DoorCopy = { txid: string; index: number; pkg: TicketPackage }
export type Reconcile = { checkedAt: string; state: 'confirmed' | 'waiting' | 'lost' | 'unknown'; winnerTxid?: string; reason: string }
export type Admission = {
  id: string
  revision: number
  eventId: string
  admittedAt: string
  admitted: DoorCopy & { mined: boolean }
  refused: (DoorCopy & { at: string })[]
  reconcile?: Reconcile
}
export type DoorDecision =
  | { kind: 'not-admissible' }
  | { kind: 'admit'; mined: true }
  | { kind: 'needs-mining' }
  | { kind: 'transferred'; by?: string }
  | { kind: 'unchecked' }
  | { kind: 'already-admitted'; at: string; differentCopy: boolean }
export type SpendCheck = {
  state: 'unspent' | 'spent' | 'unknown'
  source: 'live' | 'saved' | 'none'
  checkedAt?: string
  by?: string
  liveFailed?: boolean
}

export const admissionKey = (eventId: string, pkg: TicketPackage): string =>
  `${eventId}:${pkg.issuance.origin.txid}.${pkg.issuance.origin.index}`
const sameCopy = (a: { txid: string; index: number }, b: TicketPackage) => a.txid === b.current.txid && a.index === b.current.index
const copy = (pkg: TicketPackage): DoorCopy => ({ txid: pkg.current.txid, index: pkg.current.index, pkg })

export function doorDecision(policy: Policy, existing: Admission | undefined, pkg: TicketPackage, spend: SpendCheck): DoorDecision {
  if (policy === 'rejected' || policy === 'incomplete') return { kind: 'not-admissible' }
  if (existing) return { kind: 'already-admitted', at: existing.admittedAt, differentCopy: !sameCopy(existing.admitted, pkg) }
  if (policy !== 'passes-poc-policy') return { kind: 'needs-mining' }
  if (spend.state === 'spent') return { kind: 'transferred', ...(spend.by ? { by: spend.by } : {}) }
  return spend.state === 'unspent' ? { kind: 'admit', mined: true } : { kind: 'unchecked' }
}
// The offline answer from the list saved at the last preparation. A ticket the
// list does not cover is unknown, not unspent.
export function savedSpend(list: SpentList | undefined, pkg: TicketPackage): SpendCheck {
  if (!list || list.id !== pkg.issuance.eventId) return { state: 'unknown', source: 'none' }
  const checkedAt = list.checkedAt
  if (!list.tickets.includes(outpoint(pkg.issuance.origin.txid, pkg.issuance.origin.index)))
    return { state: 'unknown', source: 'saved', checkedAt }
  return { state: list.spent.includes(outpoint(pkg.current.txid, pkg.current.index)) ? 'spent' : 'unspent', source: 'saved', checkedAt }
}
export function admit(existing: Admission | undefined, eventId: string, pkg: TicketPackage, mined: boolean, now: string): Admission {
  if (existing) throw Error('This ticket is already admitted at this door.')
  return { id: admissionKey(eventId, pkg), revision: 0, eventId, admittedAt: now, admitted: { ...copy(pkg), mined }, refused: [] }
}
export function refuse(existing: Admission, pkg: TicketPackage, now: string): Admission {
  if (sameCopy(existing.admitted, pkg) || existing.refused.some(item => sameCopy(item, pkg))) return existing
  return { ...existing, revision: existing.revision + 1, refused: [...existing.refused, { ...copy(pkg), at: now }] }
}

const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
function readCopy(value: unknown): DoorCopy {
  const v = value as DoorCopy
  const pkg = normalizeScannerTicket(v?.pkg)
  if (v.txid !== pkg.current.txid || v.index !== pkg.current.index) throw Error('Saved door admission is invalid.')
  return { txid: v.txid, index: v.index, pkg }
}
export function readAdmission(value: unknown, previous?: Admission): Admission {
  const v = value as Admission
  if (
    !v ||
    typeof v.eventId !== 'string' ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !date(v.admittedAt) ||
    !Array.isArray(v.refused) ||
    typeof v.admitted?.mined !== 'boolean'
  )
    throw Error('Saved door admission is invalid.')
  const admitted = { ...readCopy(v.admitted), mined: v.admitted.mined }
  if (v.id !== admissionKey(v.eventId, admitted.pkg)) throw Error('Saved door admission is invalid.')
  const refused = v.refused.map(item => {
    if (!date(item?.at)) throw Error('Saved door admission is invalid.')
    const checked = readCopy(item)
    if (admissionKey(v.eventId, checked.pkg) !== v.id) throw Error('Saved door admission is invalid.')
    return { ...checked, at: item.at }
  })
  let reconcile: Reconcile | undefined
  if (v.reconcile !== undefined) {
    const r = v.reconcile
    if (
      !date(r.checkedAt) ||
      !['confirmed', 'waiting', 'lost', 'unknown'].includes(r.state) ||
      typeof r.reason !== 'string' ||
      (r.winnerTxid !== undefined && !/^[0-9a-f]{64}$/.test(r.winnerTxid))
    )
      throw Error('Saved door admission is invalid.')
    reconcile = { checkedAt: r.checkedAt, state: r.state, reason: r.reason, ...(r.winnerTxid ? { winnerTxid: r.winnerTxid } : {}) }
  }
  if (previous) {
    if (previous.admitted.txid !== admitted.txid || previous.admitted.index !== admitted.index || previous.admittedAt !== v.admittedAt)
      throw Error('The admitted copy cannot change.')
    if (previous.refused.some((item, i) => refused[i]?.txid !== item.txid || refused[i]?.index !== item.index))
      throw Error('A refused copy cannot be removed.')
  }
  return {
    id: v.id,
    revision: v.revision,
    eventId: v.eventId,
    admittedAt: v.admittedAt,
    admitted,
    refused,
    ...(reconcile ? { reconcile } : {}),
  }
}
export const admissionStore = createStore('scanner-admissions', readAdmission)
