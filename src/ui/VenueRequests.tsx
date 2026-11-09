import { useEffect, useState } from 'react'
import { api } from '../auth/api.ts'
import type { AttendeeRequest } from '../marketplace/types.ts'
export function VenueRequests({ eventId, disabled, onReview }: { eventId: string; disabled: boolean; onReview: (request: AttendeeRequest) => void }) {
 const [requests, setRequests] = useState<AttendeeRequest[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [next, setNext] = useState<number | null>(null)
 const [reload, setReload] = useState(0)
 useEffect(() => {
  let active = true; setBusy(true); setError('')
  void api<{ requests: AttendeeRequest[]; nextOffset: number | null }>(`/api/events/${eventId}/requests`).then(result => { if (active) { setRequests(result.requests ?? []); setNext(result.nextOffset ?? null) } }).catch(e => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) })
  return () => { active = false }
 }, [eventId, reload])
 async function more() {
  if (next === null || busy) return
  setBusy(true)
  try { const result = await api<{ requests: AttendeeRequest[]; nextOffset: number | null }>(`/api/events/${eventId}/requests?offset=${next}`); setRequests(items => [...items, ...result.requests.filter(r => !items.some(i => i.id === r.id))]); setNext(result.nextOffset) }
  catch (e) { setError((e as Error).message) } finally { setBusy(false) }
 }
 return <section className="venue-inbox"><div className="event-list-heading"><div><span className="home-eyebrow">ATTENDEE REQUESTS</span><h3>People waiting for a ticket.</h3></div><button className="btn" disabled={disabled || busy} onClick={() => setReload(n => n + 1)}>Refresh requests</button></div>
 {busy && <p role="status">Loading requests…</p>}{error && <p className="event-error" role="alert">{error}</p>}
 {!busy && !error && !requests.length && <p>No requests yet. Publish your event so attendees can find it.</p>}
 <div className="request-list">{requests.map(request => <article key={request.id}><div><strong>Request {request.id.slice(0, 8)}</strong><p>{request.event.name} · Revision {request.event.revision}</p><p className="event-help">{request.status === 'requested' ? 'Awaiting your approval' : request.status === 'complete' ? 'Ticket delivered' : 'Issuance already reviewed or started'}</p><details><summary>Recipient identity</summary><code>{request.proof.attendee}</code><p>Receiving key</p><code>{request.proof.request.recipient.publicKey}</code></details></div><button className="btn" disabled={disabled || busy} onClick={() => onReview(request)}>{request.ticketId ? 'Open ticket record' : 'Review new issuance'}</button></article>)}</div>
 {next !== null && <button className="btn" disabled={busy || disabled} onClick={() => void more()}>More requests</button>}</section>
}
