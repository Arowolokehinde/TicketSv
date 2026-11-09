import type { TicketPackage } from '../tickets/types.ts'
import { readTicketPackage } from '../tickets/codec.ts'
// Recovery copy only: this never authorizes another wallet action.
async function database(): Promise<IDBDatabase> {
 return new Promise((resolve, reject) => {
  const request = indexedDB.open('ticketsv-venue-evidence-v1', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('packages')
  request.onsuccess = () => resolve(request.result)
  request.onerror = request.onblocked = () => reject(Error('Local evidence storage is unavailable.'))
 })
}
export async function venueEvidence(owner: string, ticketId: string, pkg?: TicketPackage): Promise<TicketPackage | undefined> {
 const db = await database()
 return new Promise((resolve, reject) => {
  const tx = db.transaction('packages', pkg ? 'readwrite' : 'readonly'), store = tx.objectStore('packages')
  const key = `${owner}:${ticketId}`, request = pkg ? store.put(readTicketPackage(JSON.stringify(pkg)), key) : store.get(key)
  tx.oncomplete = () => { db.close(); try { resolve(pkg ?? (request.result ? readTicketPackage(JSON.stringify(request.result)) : undefined)) } catch (error) { reject(error) } }
  tx.onerror = tx.onabort = () => { db.close(); reject(Error('Local evidence could not be saved. Download it before leaving this page.')) }
 })
}
