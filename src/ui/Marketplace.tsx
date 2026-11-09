import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WalletInterface } from '@bsv/sdk'
import { api, currentAuthEpoch, currentAuthIdentity } from '../auth/api.ts'
import { useAuth } from '../auth/AuthProvider.tsx'
import {DashboardIcon} from './DashboardIcon.tsx'
import type { AttendeeRequest, PublishedEvent } from '../marketplace/types.ts'
import { EventCover, eventDate } from './VenueEvents.tsx'
import '../styles/marketplace.css'

export function EventsShell({ children }: { children: ReactNode }) {
 return <div className="marketplace events-modern"><main id="main" className="market-content">{children}</main></div>
}
export function EventsPage() {
 const [events, setEvents] = useState<PublishedEvent[]>([]), [next, setNext] = useState<number | null>(null)
 const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false)
 const mounted = useRef(true), active = useRef(false)
 async function load(offset = 0) {
  if (active.current) return
  active.current = true; setBusy(true); setError('')
  try { const result = await api<{ events: PublishedEvent[]; nextOffset: number | null }>(`/api/marketplace/events?offset=${offset}`); if (mounted.current) { setEvents(items => offset ? [...items, ...result.events.filter(e => !items.some(i => i.id === e.id))] : result.events); setNext(result.nextOffset); setLoaded(true) } }
  catch (e) { if (mounted.current) setError((e as Error).message) }
  finally { active.current = false; if (mounted.current) setBusy(false) }
 }
 useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [])
 return <EventsShell><div className="market-intro"><div><span className="events-eyebrow"><DashboardIcon name="sparkle"/> SOMETHING TO LOOK FORWARD TO</span><h1>Explore <em>events.</em></h1><p>Browse the event marketplace. Explore published events and request a ticket from the organiser.</p></div><div className="events-intro-mark" aria-hidden="true"><DashboardIcon name="explore"/></div></div>
 <div className="events-collection-heading"><div><h2>Event marketplace <span aria-label={`${events.length} events loaded`}>{events.length}{next!==null?'+':''}</span></h2><p>All published events, with upcoming events first.</p></div><span className="events-collection-note"><DashboardIcon name="ticket"/> Your next experience starts here</span></div>
 {error&&<div role="alert" className="event-error events-error"><div><DashboardIcon name="activity"/><p>{error}</p></div><button className="btn" disabled={busy} onClick={()=>void load()}>Try again <DashboardIcon name="refresh"/></button></div>}
 {loaded&&!busy&&!error&&!events.length&&<div className="event-empty events-empty"><span className="events-empty-icon"><DashboardIcon name="explore"/></span><h2>No events available yet.</h2><p>New published events will appear here. Check back soon.</p></div>}
 {busy&&!loaded&&!events.length&&<div className="events-loading" aria-hidden="true">{[0,1,2].map(i=><div key={i}><span/><i/><i/><i/></div>)}</div>}
 <div className="market-grid">{events.map(event=><article className="market-card" key={event.id}>
  <div className="public-event-cover"><EventCover image={null} coverUrl={event.coverUrl} name={event.name}/><time className="public-event-date" dateTime={event.date}><DashboardIcon name="calendar"/>{eventDate(event.date)}</time></div>
  <div className="public-event-info"><div className="public-event-meta"><span><DashboardIcon name="pin"/>{event.venue}</span><time>{event.time}</time></div>{event.requestsOpen===false&&<span className="badge b-outline">Past event</span>}<h2>{event.name}</h2><p className="public-event-description">{event.description}</p><a className="btn public-event-link" aria-label={`Explore ${event.name}`} href={`/events/${event.id}`}>View event <DashboardIcon name="arrow"/></a></div>
 </article>)}</div>
 {busy&&<p className="events-loading-status" role="status">Loading events…</p>}{next!==null&&<div className="events-more"><button className="btn" disabled={busy} onClick={()=>void load(next)}>More events <DashboardIcon name="arrow"/></button></div>}

 </EventsShell>
}
function RequestTicket({ event }: { event: PublishedEvent }) {
 const auth = useAuth(), owner = auth.session?.identityKey
 const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState<AttendeeRequest>()
 const [checked, setChecked] = useState(false)
 const requestId = useRef(crypto.randomUUID()), controller = useRef<AbortController | null>(null)
 useEffect(() => {
  let active = true
  if (owner) void api<{ requests: AttendeeRequest[] }>(`/api/tickets/requests?eventId=${event.id}`).then(result => { if (active) { setSaved(result.requests[0]); setChecked(true) } }).catch(e => { if (active) setError((e as Error).message) })
  return () => { active = false; controller.current?.abort(); controller.current = null }
 }, [owner, event.id])
 async function request() {
  if (!owner) { auth.open(`/events/${event.id}`); return }
  if (!consent || controller.current || saved || !checked) return
  const attempt = new AbortController(), epoch = currentAuthEpoch(); controller.current = attempt
  const check = () => { attempt.signal.throwIfAborted(); if (currentAuthEpoch() !== epoch || currentAuthIdentity() !== owner) throw Error('Your signed-in account changed. Reopen this event before requesting.') }
  setBusy(true); setError('')
  const timeout = setTimeout(() => attempt.abort(Error('The request timed out. Reload to check whether it was saved before trying again.')), 60_000)
  let onAbort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
   onAbort = () => reject(attempt.signal.reason)
   attempt.signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
   await Promise.race([cancelled, (async () => {
   const { openWalletClient } = await import('../wallet/connection.ts'); check()
   const method = sessionStorage.getItem('ticketsv-wallet-transport')
   const client = await openWalletClient(method === 'browser-native' || method === 'desktop-https' ? method : 'desktop-http', attempt.signal); check()
   const wallet = new Proxy(client, { get(target, key) {
    if (!['getNetwork', 'getPublicKey', 'createSignature'].includes(String(key))) throw Error('Only receiving-key checks are allowed.')
    return async (...args: unknown[]) => { check(); const result = await (target[key as keyof WalletInterface] as Function).apply(target, args); check(); return result }
   } })
   const { prepareAttendeeRequest } = await import('../wallet/attendee-request.ts'); check()
   const proof = await prepareAttendeeRequest(wallet, { eventId: event.id, revision: event.revision, venue: event.venueIdentity, attendee: owner, origin: location.origin }, requestId.current); check()
   const result = await api<AttendeeRequest>('/api/tickets/requests', { method: 'POST', body: JSON.stringify({ proof }), signal: attempt.signal }); check()
   setSaved(result); setConsent(false)
   })()])
  } catch (e) { if (controller.current === attempt && !attempt.signal.aborted) setError((e as Error).message); else if (controller.current === attempt) setError(attempt.signal.reason?.message ?? 'Request cancelled.') }
  finally { clearTimeout(timeout); attempt.signal.removeEventListener('abort', onAbort); if (controller.current === attempt) { controller.current = null; setBusy(false) } attempt.abort() }
 }
 return <aside className="event-request-panel"><span className="public-request-icon"><DashboardIcon name="ticket"/></span><span className="home-eyebrow">YOUR PLACE AT THE EVENT</span><h2>Request a ticket.</h2><p>The organiser reviews your request before issuing. Requesting does not reserve admission or make a payment.</p>
 {saved ? <><p className="event-saved" role="status">Request sent. Follow its progress in your Dashboard.</p><a className="btn primary" href="/tickets">Open dashboard</a></> : <>
 {owner && <label className="issuance-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />I authorize a receiving-key signature for this event. No transaction or fee is involved.</label>}
 <button className="btn primary" aria-label="Request ticket" disabled={auth.loading || busy || Boolean(owner && (!consent || !checked))} onClick={() => void request()}>{busy ? 'Preparing request…' : 'Request ticket'}</button>
 {busy && <button className="btn" onClick={() => controller.current?.abort(Error('Request cancelled. Reload to check its saved status.'))}>Cancel request</button>}
 {!owner && <p className="event-help">Connect your wallet to request a ticket.</p>}</>}
 {error && <p className="event-error" role="alert">{error}</p>}
 </aside>
}
export function EventPage({ id }: { id: string }) {
 const auth = useAuth(), [event, setEvent] = useState<PublishedEvent>(), [error, setError] = useState('')
 useEffect(() => { let active = true; void api<PublishedEvent>(`/api/marketplace/events/${id}`).then(e => { if (active) setEvent(e) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [id])
 return <EventsShell><a className="receive-back" href="/events">← All events</a>{error ? <p role="alert" className="event-error">{error}</p> : !event ? <p role="status">Loading event…</p> : <div className="market-detail"><article className="public-event-detail"><EventCover image={null} coverUrl={event.coverUrl} name={event.name} /><div className="public-event-detail-body"><p className="market-date">{eventDate(event.date)} · {event.time} ({event.timezone})</p><h1>{event.name}</h1><p><strong>{event.venue}</strong><br />{event.address}</p><p className="market-description">{event.description}</p><details className="wallet-advanced"><summary>Organiser identity</summary><p>This is the wallet identity publishing the event. Confirm the organiser independently before trusting their tickets.</p><code>{event.venueIdentity}</code></details></div></article><>{event.requestsOpen===false?<aside className="event-request-panel"><span className="public-request-icon"><DashboardIcon name="ticket"/></span><h2>Requests closed.</h2><p>This event has passed. Its published details remain available to view.</p><a className="btn" href="/events">Explore other events</a></aside>:<RequestTicket key={auth.session?.identityKey ?? 'guest'} event={event} />}</></div>}</EventsShell>
}
