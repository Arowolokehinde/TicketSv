import { readEventDraft, validateEventDetails, type EventDetails, type EventDraft } from './drafts.ts'

// Separate from wallet records and experiment databases. No organiser ownership
// or public availability is inferred from a browser-local draft.
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ticketsv-event-drafts', 1)
    let blocked = false
    request.onupgradeneeded = () => request.result.createObjectStore('events', { keyPath: 'id' })
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('Event storage is blocked. Close other TicketSV tabs and try again.')) }
  })
}

export async function listEventDrafts(): Promise<EventDraft[]> {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readonly')
      const request = tx.objectStore('events').getAll()
      tx.oncomplete = () => {
        try { resolve(request.result.map(readEventDraft).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) }
        catch (error) { reject(error) }
      }
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Event storage unavailable.'))
    })
  } finally { db.close() }
}

export async function saveEventDraft(details: EventDetails, previous?: EventDraft): Promise<EventDraft> {
  const validated = validateEventDetails(details)
  const id = previous?.id ?? crypto.randomUUID()
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite')
      const store = tx.objectStore('events')
      const request = store.get(id)
      let saved: EventDraft
      let failure: unknown
      request.onsuccess = () => {
        try {
          const current = request.result === undefined ? undefined : readEventDraft(request.result)
          if (previous ? !current || current.revision !== previous.revision : current) {
            throw new Error('This event changed in another tab. Copy any unsaved text, cancel editing, and reload the event before trying again.')
          }
          const now = new Date().toISOString()
          saved = { ...validated, id, status: 'draft', revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now }
          store.put(saved)
        } catch (error) { failure = error; tx.abort() }
      }
      tx.oncomplete = () => resolve(saved)
      tx.onabort = tx.onerror = () => reject(failure ?? new Error('The draft could not be saved. Your form is still here. Check browser storage and try again.'))
    })
  } finally { db.close() }
}
