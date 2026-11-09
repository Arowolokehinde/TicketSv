import { Hash, Utils } from '@bsv/sdk'
import { readAttendeeEvidence, type AttendeeEvidence } from '../offline/attendee-evidence.ts'
import type { ImportReview } from './import-review.ts'

export type AttendeeImportRecord = {
 version: 1; evidence: AttendeeEvidence; fingerprint: string
 attempt: { id: string; startedAt: string; outcome: 'pending' | 'accepted' | 'unknown'; finishedAt?: string }
 observations: ImportReview[]
}
const DB = 'ticketsv-attendee-import-v1'
function evidence(value: AttendeeEvidence) {
 if (!value || typeof value !== 'object' || typeof value.origin !== 'string') throw Error('Wallet preparation evidence is damaged. Do not retry importing.')
 return readAttendeeEvidence(value, value.origin)
}
export function importKey(value: AttendeeEvidence): string {
 const e = evidence(value)
 return `${e.attendee}:testnet:${e.pkg.current.txid}`
}
export function importFingerprint(value: AttendeeEvidence): string {
 const { savedAt: _savedAt, ...bound } = evidence(value)
 return Utils.toHex(Hash.sha256(Utils.toArray(JSON.stringify(bound), 'utf8')))
}
function date(value: unknown): string {
 if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) throw Error('Invalid wallet preparation date.')
 return value
}
export function readAttendeeImport(value: unknown): AttendeeImportRecord {
 if (!value || typeof value !== 'object') throw Error('Wallet preparation record is damaged. Do not retry importing.')
 const r = value as AttendeeImportRecord, e = evidence(r.evidence), a = r.attempt
 if (r.version !== 1 || r.fingerprint !== importFingerprint(e) || !a || typeof a.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(a.id) || !['pending', 'accepted', 'unknown'].includes(a.outcome) || !Array.isArray(r.observations) || r.observations.length > 16) throw Error('Wallet preparation record is damaged. Do not retry importing.')
 if (a.outcome === 'pending' ? a.finishedAt !== undefined : a.finishedAt === undefined) throw Error('Invalid wallet import completion state.')
 const observations = r.observations.map(o => {
  if (!o || !['present', 'absent', 'inconclusive'].includes(o.state) || o.walletIdentity !== e.attendee || o.requestId !== e.proof.request.requestId || o.outpoint !== `${e.pkg.current.txid}.${e.pkg.current.index}` || typeof o.reason !== 'string' || o.reason.length > 1000 || typeof o.walletVersion !== 'string' || o.walletVersion.length > 100 || typeof o.snapshotId !== 'string' || !/^[0-9a-f]{64}$/.test(o.snapshotId)) throw Error('Wallet preparation observation does not match this ticket.')
  return { state: o.state, reason: o.reason, walletIdentity: o.walletIdentity, requestId: o.requestId, outpoint: o.outpoint, walletVersion: o.walletVersion, snapshotId: o.snapshotId, checkedAt: date(o.checkedAt) }
 })
 return { version: 1, evidence: e, fingerprint: r.fingerprint, attempt: { id: a.id, startedAt: date(a.startedAt), outcome: a.outcome, ...(a.finishedAt ? { finishedAt: date(a.finishedAt) } : {}) }, observations }
}
export function newAttendeeImport(e: AttendeeEvidence): AttendeeImportRecord {
 return readAttendeeImport({ version: 1, evidence: e, fingerprint: importFingerprint(e), attempt: { id: crypto.randomUUID(), startedAt: new Date().toISOString(), outcome: 'pending' }, observations: [] })
}
export function finishAttendeeImport(value: unknown, id: string, outcome: 'accepted' | 'unknown'): AttendeeImportRecord {
 const r = readAttendeeImport(value)
 if (r.attempt.id !== id || r.attempt.outcome !== 'pending') throw Error('This import response is already saved or belongs to another attempt.')
 return readAttendeeImport({ ...r, attempt: { ...r.attempt, outcome, finishedAt: new Date().toISOString() } })
}
export function appendAttendeeObservation(value: unknown, id: string, review: ImportReview): AttendeeImportRecord {
 const r = readAttendeeImport(value)
 if (r.attempt.id !== id) throw Error('The import attempt changed. Reload its record.')
 return readAttendeeImport({ ...r, observations: [...r.observations.slice(-15), review] })
}
function open(): Promise<IDBDatabase> {
 return new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 1)
  request.onupgradeneeded = () => request.result.createObjectStore('imports')
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  request.onerror = request.onblocked = () => reject(Error('Wallet preparation storage is unavailable. No new import can start.'))
 })
}
export async function loadAttendeeImport(e: AttendeeEvidence): Promise<AttendeeImportRecord | undefined> {
 const key = importKey(e), db = await open()
 return new Promise((resolve, reject) => {
  const tx = db.transaction('imports'), request = tx.objectStore('imports').get(key)
  tx.oncomplete = () => {
   db.close()
   try {
    const r = request.result === undefined ? undefined : readAttendeeImport(request.result)
    if (r && (importKey(r.evidence) !== key || r.fingerprint !== importFingerprint(e))) throw Error('Saved import evidence differs. Review the existing record; do not retry.')
    resolve(r)
   } catch (error) { reject(error) }
  }
  tx.onabort = tx.onerror = () => { db.close(); reject(Error('Wallet preparation record could not be read.')) }
 })
}
async function update(e: AttendeeEvidence, change: (old: unknown) => AttendeeImportRecord): Promise<AttendeeImportRecord> {
 const key = importKey(e), db = await open()
 return new Promise((resolve, reject) => {
  const tx = db.transaction('imports', 'readwrite'), store = tx.objectStore('imports'), request = store.get(key)
  let next: AttendeeImportRecord, error: unknown
  request.onsuccess = () => {
   try {
    if (request.result !== undefined) {
     const previous = readAttendeeImport(request.result)
     if (importKey(previous.evidence) !== key || previous.fingerprint !== importFingerprint(e)) throw Error('Saved import evidence differs. Review the existing record; do not retry.')
    }
    next = change(request.result)
    if (importKey(next.evidence) !== key || next.fingerprint !== importFingerprint(e)) throw Error('Wallet preparation context changed.')
    store.put(next, key)
   } catch (caught) { error = caught; tx.abort() }
  }
  tx.oncomplete = () => { db.close(); resolve(next) }
  tx.onabort = tx.onerror = () => { db.close(); reject(error ?? Error('Import outcome could not be saved. Do not retry; review the saved attempt.')) }
 })
}
export const attendeeImportStore = {
 load: loadAttendeeImport,
 claim: (e: AttendeeEvidence) => update(e, old => { if (old !== undefined) throw Error('A wallet import was already attempted. Reconcile without retrying.'); return newAttendeeImport(e) }),
 finish: (e: AttendeeEvidence, id: string, outcome: 'accepted' | 'unknown') => update(e, old => finishAttendeeImport(old, id, outcome)),
 observe: (e: AttendeeEvidence, id: string, review: ImportReview) => update(e, old => appendAttendeeObservation(old, id, review)),
}
