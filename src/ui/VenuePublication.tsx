import { useEffect, useState } from 'react'
import { api } from '../auth/api.ts'
import type { AccountEvent } from '../events/api.ts'
import { EventCover, eventDate } from './VenueEvents.tsx'
type Publication = { published: boolean; revision: number | null }
export function VenuePublication({ event, onClose }: { event: AccountEvent; onClose: () => void }) {
 const [state, setState] = useState<Publication>(), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
 const path = `/api/events/${event.id}/publication`
 useEffect(() => { let active = true; void api<Publication>(path).then(value => { if (active) setState(value) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [path])
 async function publish(published: boolean) {
  if (busy || !state || (published && !consent)) return
  setBusy(true); setError('')
  try { setState(await api<Publication>(path, { method: 'POST', body: JSON.stringify({ published, revision: event.revision }) })); setConsent(false) }
  catch (e) { setError((e as Error).message) } finally { setBusy(false) }
 }
 return <section className="publication-panel"><div className="event-editor-heading"><div><span className="home-eyebrow">EVENT PUBLICATION</span><h2>Let people find your event.</h2></div><button className="btn" disabled={busy} onClick={onClose}>Back to events</button></div>
 <div className="publication-review"><EventCover image={event.image} name={event.name} coverUrl={event.coverUrl} /><div><h3>{event.name}</h3><p>{eventDate(event.date)} · {event.time} ({event.timezone})</p><p>{event.venue}<br />{event.address}</p><p className="market-description">{event.description}</p><p className="event-help">Reviewing revision {event.revision}. These event details, the cover image and your organiser wallet identity will be public. Publishing does not issue tickets.</p></div></div>
 {state && <><p className="event-saved" role="status">{state.published ? 'Published on Events' : 'Private · Not published'}</p>{state.published && <p>Published revision {state.revision}. <a href={`/events/${event.id}`}>View public event ↗</a></p>}
 {(!state.published || state.revision !== event.revision) && <><label className="issuance-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Publish these reviewed details and my organiser identity to the public Events page.</label><button className="btn primary" aria-label="Publish event" disabled={!consent || busy} onClick={() => void publish(true)}>Publish event</button></>}
 {state.published && <button className="btn" disabled={busy} onClick={() => void publish(false)}>Unpublish event</button>}
 <p className="event-help">Editing your draft keeps the published version unchanged until you publish again. Existing attendee requests retain the event details they requested.</p></>}
 {error && <p className="event-error" role="alert">{error}</p>}</section>
}
