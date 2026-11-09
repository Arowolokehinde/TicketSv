import { Transaction } from '@bsv/sdk'
import { fromBase64, publicKey } from '../tickets/codec.ts'
import { parseObservation, parsePolicy } from '../settlement/arc.ts'
import { readSigningEvidenceBytes } from '../verification/signing-spv.ts'
import { readHandoffRequest, readHandoffTicket } from './evidence.ts'
import type { Attempt, Funding, HandoffRequest, HandoffTicket, RecipientRecord, RecordStore, SenderRecord } from './types.ts'

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Damaged handoff record. Do not retry.'); return value as Record<string, unknown> }
function date(value: unknown): string { if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw Error('Invalid handoff date.'); return value }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b) }
function fixed(a: unknown, b: unknown, name: string): void { if (!same(a, b)) throw Error(`Saved ${name} cannot change. Reload the existing record.`) }
function revision(v: Record<string, unknown>, kind: string): void { if (v.kind !== kind || v.version !== 1 || typeof v.id !== 'string' || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0) throw Error('Invalid handoff record identity or revision.') }
function attempt(value: unknown): Attempt | undefined {
 if (value === undefined) return undefined
 const a = object(value)
 if (typeof a.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(a.id) || !['pending', 'complete', 'unknown'].includes(a.outcome as string) || (a.outcome === 'pending' ? a.finishedAt !== undefined : a.finishedAt === undefined)) throw Error('Invalid handoff attempt.')
 return { id: a.id, startedAt: date(a.startedAt), outcome: a.outcome as Attempt['outcome'], ...(a.finishedAt !== undefined ? { finishedAt: date(a.finishedAt) } : {}) }
}
function monotonic(old: Attempt | undefined, next: Attempt | undefined): void {
 if (!old) { if (next && next.outcome !== 'pending') throw Error('A durable pending claim must precede a completed attempt.'); return }
 if (!next || next.id !== old.id || next.startedAt !== old.startedAt) throw Error('A previous attempt cannot be removed or replaced.')
 if (old.outcome !== 'pending') fixed(old, next, 'attempt outcome')
}
function funding(value: unknown): Funding | undefined {
 if (value === undefined) return undefined
 const f = object(value), k = object(f.key), p = object(f.policy)
 if (!Array.isArray(k.protocolID) || k.protocolID.length !== 2 || k.protocolID[0] !== 2 || typeof k.protocolID[1] !== 'string' || k.protocolID[1].length > 100 || !k.protocolID[1].length || typeof k.keyID !== 'string' || !k.keyID.length || k.keyID.length > 200 || k.counterparty !== 'self' || !Number.isSafeInteger(f.amount) || (f.amount as number) < 1 || (f.amount as number) > 1000) throw Error('Invalid dedicated handoff funding.')
 const out: Funding = { key: { publicKey: publicKey(k.publicKey), protocolID: [2, k.protocolID[1]], keyID: k.keyID, counterparty: 'self' }, amount: f.amount as number, policy: parsePolicy({ policy: { maxtxsizepolicy: p.maxTxBytes, miningFee: { satoshis: p.feeSatoshis, bytes: p.feeBytes } } }) }
 if (f.txid !== undefined) { if (typeof f.txid !== 'string' || !/^[0-9a-f]{64}$/.test(f.txid)) throw Error('Invalid funding transaction.'); out.txid = f.txid }
 if (f.index !== undefined) { if (!Number.isSafeInteger(f.index) || (f.index as number) < 0 || (f.index as number) > 0xffffffff) throw Error('Invalid funding output.'); out.index = f.index as number }
 if (f.beef !== undefined) {
  if (!out.txid || out.index === undefined) throw Error('Funding evidence requires its transaction and output.')
  const evidence = readSigningEvidenceBytes(out.txid, fromBase64(f.beef)), tx = Transaction.fromAtomicBEEF([...evidence.atomicBeef])
  if (!tx.outputs[out.index] || tx.outputs[out.index].satoshis !== out.amount) throw Error('Saved funding output does not match its receipt.')
  out.beef = f.beef as string
 }
 if (f.observation !== undefined) { if (!out.txid) throw Error('Funding observation requires its transaction.'); const o = object(f.observation); out.observation = { ...parseObservation(o, out.txid), observedAt: date(o.observedAt) } }
 if (f.rawReceipt !== undefined) {
  const raw = JSON.stringify(f.rawReceipt)
  if (!raw || new TextEncoder().encode(raw).length > 8 * 1024 * 1024) throw Error('Funding receipt exceeds storage limits.')
  out.rawReceipt = JSON.parse(raw) as unknown
 }
 return out
}
function stableTicket(ticket: HandoffTicket): unknown { return { ...ticket, savedAt: '', pkg: { ...ticket.pkg, atomicBeefBase64: '' }, ...(ticket.issuanceEvidence ? { issuanceEvidence: { ...ticket.issuanceEvidence, savedAt: '', pkg: { ...ticket.issuanceEvidence.pkg, atomicBeefBase64: '' } } } : {}) } }
export function sourceKey(value: HandoffTicket): string { const t = readHandoffTicket(value); return `${t.holder}:testnet:${t.pkg.current.txid}.${t.pkg.current.index}` }
export function recipientKey(value: HandoffRequest): string { const r = readHandoffRequest(value); return `${r.recipientIdentity}:${r.request.requestId}` }
export function readSender(value: unknown, previous?: SenderRecord): SenderRecord {
 const v = object(value); revision(v, 'ticketsv-handoff-sender')
 const ticket = readHandoffTicket(v.ticket), out: SenderRecord = { kind: 'ticketsv-handoff-sender', version: 1, id: v.id as string, revision: v.revision as number, ticket }
 if (out.id !== sourceKey(ticket)) throw Error('Sender record must use its account and source outpoint.')
 if (v.funding !== undefined) out.funding = funding(v.funding)
 if (v.fundAttempt !== undefined) out.fundAttempt = attempt(v.fundAttempt)
 if (v.signAttempt !== undefined) out.signAttempt = attempt(v.signAttempt)
 if (v.request !== undefined) {
  out.request = readHandoffRequest(v.request)
  const i = out.request.invitation
  if (i.origin !== ticket.origin || i.trustedVenue !== ticket.trustedVenue || i.eventId !== ticket.pkg.issuance.eventId || i.ticketId !== ticket.pkg.issuance.ticketId || !same(i.source, ticket.pkg.current) || !same(i.event, ticket.event)) throw Error('Sender request changed its source or trust context.')
 }
 if (v.transfer !== undefined) {
  out.transfer = readHandoffTicket(v.transfer)
  if (!out.request || !same(out.transfer.request, out.request) || !same(out.transfer.pkg.issuance, ticket.pkg.issuance) || !same(out.transfer.pkg.lineageRawTxs.slice(0, -1), ticket.pkg.lineageRawTxs)) throw Error('Saved transfer does not continue the requested source.')
 }
 if (out.fundAttempt?.outcome === 'complete' && (!out.funding?.txid || !out.funding.beef || out.funding.index === undefined)) throw Error('Completed funding requires its saved output.')
 if (out.signAttempt && (!out.request || out.fundAttempt?.outcome !== 'complete')) throw Error('Signing requires a saved request and completed funding.')
 if (out.signAttempt?.outcome === 'complete' && !out.transfer) throw Error('Completed signing requires the exact saved transfer.')
 if (previous) {
  const old = readSender(previous)
  fixed(old.id, out.id, 'sender identity'); fixed(stableTicket(old.ticket), stableTicket(ticket), 'source ticket')
  monotonic(old.fundAttempt, out.fundAttempt); monotonic(old.signAttempt, out.signAttempt)
  if (old.request) fixed(old.request, out.request, 'recipient request')
  if (old.transfer) { if (!out.transfer) throw Error('Saved transfer cannot be removed.'); fixed(stableTicket(old.transfer), stableTicket(out.transfer), 'signed transfer') }
  if (old.funding) {
   if (!out.funding) throw Error('Saved funding cannot be removed.')
   for (const field of ['key', 'amount', 'policy'] as const) fixed(old.funding[field], out.funding[field], `funding ${field}`)
   for (const field of ['txid', 'index', 'rawReceipt'] as const) if (old.funding[field] !== undefined) fixed(old.funding[field], out.funding[field], `funding ${field}`)
   if (old.funding.beef !== undefined && old.funding.beef !== out.funding.beef) {
    if (!out.funding.beef) throw Error('Funding transaction evidence cannot be removed.')
    fixed(Transaction.fromAtomicBEEF(fromBase64(old.funding.beef)).toHex(), Transaction.fromAtomicBEEF(fromBase64(out.funding.beef)).toHex(), 'funding transaction bytes')
   }
  }
 }
 return out
}
export function readRecipient(value: unknown, previous?: RecipientRecord): RecipientRecord {
 const v = object(value); revision(v, 'ticketsv-handoff-recipient')
 const request = readHandoffRequest(v.request), out: RecipientRecord = { kind: 'ticketsv-handoff-recipient', version: 1, id: v.id as string, revision: v.revision as number, request }
 if (out.id !== recipientKey(request)) throw Error('Recipient record identity does not match its independent request.')
 if (v.ticket !== undefined) { out.ticket = readHandoffTicket(v.ticket); if (!same(out.ticket.request, request)) throw Error('Received ticket does not match the independent request.') }
 if (previous) {
  const old = readRecipient(previous); fixed(old.id, out.id, 'recipient identity'); fixed(old.request, request, 'independent recipient request')
  if (old.ticket) { if (!out.ticket) throw Error('Received ticket cannot be removed.'); fixed(stableTicket(old.ticket), stableTicket(out.ticket), 'received ticket') }
 }
 return out
}
export function createStore<T extends { id: string; revision: number }>(name: string, validator: (value: unknown, previous?: T) => T): RecordStore<T> {
 if (!/^[a-z][a-z0-9-]{0,80}$/.test(name)) throw Error('Invalid handoff store name.')
 const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const r = indexedDB.open(`ticketsv-handoff-${name}-v1`, 1)
  r.onupgradeneeded = () => r.result.createObjectStore('records')
  r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); resolve(r.result) }
  r.onerror = r.onblocked = () => reject(Error('Handoff storage unavailable. No new action can start.'))
 })
 return {
  async load(id) {
   const db = await open()
   return new Promise((resolve, reject) => {
    const tx = db.transaction('records'), get = tx.objectStore('records').get(id)
    tx.oncomplete = () => { db.close(); try { const value = get.result === undefined ? undefined : validator(get.result); if (value && value.id !== id) throw Error('Corrupt handoff record identity.'); resolve(value) } catch (error) { reject(error) } }
    tx.onabort = tx.onerror = () => { db.close(); reject(Error('Handoff record could not be read.')) }
   })
  },
  async list() {
   const db = await open()
   return new Promise((resolve, reject) => {
    const tx = db.transaction('records'), store = tx.objectStore('records'), all = store.getAll(), keys = store.getAllKeys()
    tx.oncomplete = () => { db.close(); try { resolve((all.result as unknown[]).map((raw, i) => { const value = validator(raw); if (value.id !== keys.result[i]) throw Error('Corrupt handoff record identity.'); return value })) } catch (error) { reject(error) } }
    tx.onabort = tx.onerror = () => { db.close(); reject(Error('Handoff records could not be read.')) }
   })
  },
  async save(next, expectedRevision) {
   const normalized = validator(next)
   if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw Error('Invalid expected record revision.')
   if (normalized.revision !== (expectedRevision === undefined ? 0 : expectedRevision + 1)) throw Error('Invalid next record revision.')
   const db = await open()
   return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records'), get = store.get(normalized.id)
    let failure: unknown
    get.onsuccess = () => {
     try {
      const old = get.result === undefined ? undefined : validator(get.result)
      if (old && old.id !== normalized.id) throw Error('Corrupt existing handoff identity. Do not retry.')
      if (old?.revision !== expectedRevision || (old === undefined) !== (expectedRevision === undefined)) throw Error('Handoff record changed. Reload before continuing.')
      const checked = validator(normalized, old)
      if (checked.id !== normalized.id || checked.revision !== normalized.revision) throw Error('Validator changed record identity or revision.')
      store.put(checked, checked.id)
     } catch (error) { failure = error; tx.abort() }
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = tx.onerror = () => { db.close(); reject(failure ?? Error('Handoff outcome could not be saved. Do not retry the action.')) }
   })
  },
 }
}
export const senderStore = createStore('senders', readSender)
export const recipientStore = createStore('recipients', readRecipient)
