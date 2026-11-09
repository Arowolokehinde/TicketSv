import { loadSnapshot } from '../headers/store.ts'
import { readAttendeeEvidence, verifyAttendeeEvidence, requireMinedEvidence, type AttendeeEvidence } from './attendee-evidence.ts'
const DB = 'ticketsv-attendee-offline-v1', STORE = 'tickets'
export type SavedTicket = { key: IDBValidKey; id: string; token: string; evidence?: AttendeeEvidence; error?: string }
function open(): Promise<IDBDatabase> {
 return new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE)
  request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  request.onerror = request.onblocked = () => reject(Error('Saved ticket storage is unavailable.'))
 })
}
// IndexedDB can contain non-JSON corruption. Encode a typed object graph so
// cycles and BigInt cannot throw and prevent unrelated valid tickets loading.
function token(value: unknown): string {
 const seen = new Map<object, number>()
 function encode(v: unknown): unknown {
  if (v === null) return ['null']
  if (typeof v !== 'object') return [typeof v, String(v)]
  const previous = seen.get(v)
  if (previous !== undefined) return ['reference', previous]
  seen.set(v, seen.size)
  if (v instanceof Date) return ['date', String(v.getTime())]
  if (v instanceof ArrayBuffer) return ['buffer', Array.from(new Uint8Array(v))]
  if (ArrayBuffer.isView(v)) return [v.constructor.name, Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))]
  if (v instanceof Map) return ['map', Array.from(v, ([k, item]) => [encode(k), encode(item)])]
  if (v instanceof Set) return ['set', Array.from(v, encode)]
  return [Array.isArray(v) ? 'array' : 'object', Object.entries(v).map(([k, item]) => [k, encode(item)])]
 }
 return JSON.stringify(encode(value))
}
export async function listSavedTickets(origin: string): Promise<SavedTicket[]> {
 const db = await open()
 return new Promise((resolve, reject) => {
  const tx = db.transaction(STORE), store = tx.objectStore(STORE), keys = store.getAllKeys(), values = store.getAll()
  tx.oncomplete = () => {
   db.close()
   resolve(values.result.map((value, i) => {
    const row = { key: keys.result[i], id: token(keys.result[i]), token: token(value) }
    try {
     const evidence = readAttendeeEvidence(value, origin)
     if (row.key !== `${evidence.attendee}:${evidence.id}`) throw Error('Saved ticket account index does not match.')
     return { ...row, evidence }
    } catch { return { ...row, error: 'Saved ticket is damaged or does not match this address. Remove this device copy and save it again from Dashboard.' } }
   }))
  }
  tx.onerror = tx.onabort = () => { db.close(); reject(Error('Could not read saved tickets.')) }
 })
}
async function replace(key: IDBValidKey, expected: string, next: AttendeeEvidence | undefined, signal?: AbortSignal, guard: () => void = () => {}): Promise<void> {
 const db = await open()
 return new Promise((resolve, reject) => {
  const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE)
  let failure: unknown
  const abort = () => { failure = signal?.reason ?? Error('Save cancelled.'); try { tx.abort() } catch { /* already committed */ } }
  const cleanup = () => { signal?.removeEventListener('abort', abort); db.close() }
  tx.oncomplete = () => { cleanup(); resolve() }
  tx.onabort = tx.onerror = () => { cleanup(); reject(failure ?? Error('Could not update saved tickets. The previous copy was retained.')) }
  signal?.addEventListener('abort', abort, { once: true })
  const request = store.get(key)
  request.onsuccess = () => {
   try {
    signal?.throwIfAborted(); guard()
    if (token(request.result) !== expected) throw Error('This saved ticket changed in another tab. Open it again before saving or removing it.')
    if (next) store.put(next, key); else store.delete(key)
   } catch (error) { failure = error; tx.abort() }
  }
 })
}
export async function saveAttendeeTicket(value: unknown, origin: string, signal: AbortSignal, guard: () => void): Promise<AttendeeEvidence> {
 signal.throwIfAborted(); guard()
 const next = readAttendeeEvidence(value, origin), key = `${next.attendee}:${next.id}`
 const previous = (await listSavedTickets(origin)).find(row => row.key === key)
 requireMinedEvidence(await verifyAttendeeEvidence(next, origin, await loadSnapshot()))
 signal.throwIfAborted(); guard()
 await replace(key, previous?.token ?? token(undefined), next, signal, guard)
 return next
}
export function removeSavedTicket(row: SavedTicket): Promise<void> { return replace(row.key, row.token, undefined) }
