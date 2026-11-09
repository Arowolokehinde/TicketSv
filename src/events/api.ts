import { api, currentAuthIdentity } from '../auth/api.ts'
import { readEventDraft, type EventDetails, type EventDraft } from './drafts.ts'

export type AccountEvent = EventDraft & { coverUrl?: string }
type WireEvent = Omit<EventDraft, 'image'> & { image: { type: string; data: string } | null }
async function encode(details: EventDetails) {
  let image = null
  if (details.image) {
    const bytes = new Uint8Array(await details.image.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    image = { type: details.image.type, data: btoa(binary) }
  }
  return { ...details, image }
}
function decode(record: WireEvent & { coverUrl?: string }): AccountEvent {
  return { coverUrl: record.coverUrl, ...readEventDraft({ ...record, image: record.image ? new Blob([Uint8Array.from(atob(record.image.data), char => char.charCodeAt(0))], { type: record.image.type }) : null }) }
}
export async function listAccountEvents(offset = 0): Promise<{ events: AccountEvent[]; nextOffset: number | null }> {
  const result = await api<{ events: WireEvent[]; nextOffset: number | null }>(`/api/events?offset=${offset}`)
  return { ...result, events: result.events.map(decode) }
}
export async function getAccountEvent(id: string): Promise<AccountEvent> {
  return decode(await api<WireEvent>(`/api/events/${id}`))
}
export async function saveAccountEvent(details: EventDetails, previous?: EventDraft, requestId?: string): Promise<AccountEvent> {
  const identity = currentAuthIdentity()
  if (!identity) throw new Error('Sign in before saving an event.')
  const encoded = await encode(details)
  if (currentAuthIdentity() !== identity) throw new Error('The signed-in account changed. Reload your events.')
  return decode(await api<WireEvent>(previous ? `/api/events/${previous.id}` : '/api/events', { method: previous ? 'PUT' : 'POST', headers: { 'x-ticketsv-identity': identity }, body: JSON.stringify({ ...encoded, ...(previous ? { revision: previous.revision } : { requestId }) }) }))
}
