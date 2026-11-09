import { useEffect, useRef, useState } from 'react'
import { validateEventDetails, type EventDetails, type EventDraft } from '../events/drafts.ts'
import { getAccountEvent, type AccountEvent, listAccountEvents as listEventDrafts, saveAccountEvent as saveEventDraft } from '../events/api.ts'
import '../styles/venue.css'
import {DashboardIcon} from './DashboardIcon.tsx'
import { VenuePublication } from './VenuePublication.tsx'
import '../styles/marketplace.css'
import { VenueIssuance } from './VenueIssuance.tsx'

import {TimezonePicker} from './TimezonePicker.tsx'

function useCover(image: Blob | null): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!image) { setUrl(undefined); return }
    const next = URL.createObjectURL(image)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [image])
  return url
}

export function eventDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date to be confirmed'
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed) : 'Date to be confirmed'
}

export function EventCover({ image, name, coverUrl }: { image: Blob | null; name: string; coverUrl?: string }): React.JSX.Element {
  const blobUrl = useCover(image)
  const url = blobUrl ?? coverUrl
  return <div className="event-cover">{url ? <img src={url} alt={`Cover for ${name || 'your event'}`} /> : <div className="event-cover-art" aria-hidden="true"><span>TicketSV / EVENT</span><svg viewBox="0 0 160 110" fill="none"><path d="M15 20h130v22a13 13 0 0 0 0 26v22H15V68a13 13 0 0 0 0-26Z" /><path d="M110 20v70" strokeDasharray="4 5" /><path d="M35 43h50M35 56h35M35 69h43" /></svg><em>Something to look forward to.</em></div>}</div>
}

function EventEditor({ previous, onSaved, onCancel }: { previous?: EventDraft; onSaved: (event: EventDraft) => void; onCancel: () => void }): React.JSX.Element {
  const [requestId] = useState(() => crypto.randomUUID())
  const [initial] = useState<EventDetails>(() => previous ?? { name: '', description: '', date: '', time: '', timezone: 'UTC', venue: '', address: '', image: null })
  const [details, setDetails] = useState<EventDetails>(initial)
  const [saving, setSaving] = useState(false)
  const [readingImage, setReadingImage] = useState(false)
  const [error, setError] = useState('')
  const errorBox = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const imageVersion = useRef(0)
  const savingRef = useRef(false)
  const dirty = (Object.keys(initial) as (keyof EventDetails)[]).some(key => initial[key] !== details[key])
  useEffect(() => { heading.current?.focus(); return () => { imageVersion.current++ } }, [])
  useEffect(() => { if (error) errorBox.current?.focus() }, [error])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const change = (key: keyof Omit<EventDetails, 'image'>, value: string) => setDetails(current => ({ ...current, [key]: value }))
  const save = async () => {
    if (savingRef.current || readingImage) return
    setError('')
    let valid: EventDetails
    try { valid = validateEventDetails(details) }
    catch (failure) { setError((failure as Error).message); return }
    savingRef.current = true
    setSaving(true)
    try { onSaved(await saveEventDraft(valid, previous, requestId)) }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : ''
      setError(message || 'The draft could not be saved. Your form is still here. Please try again.')
    } finally { savingRef.current = false; setSaving(false) }
  }
  const loadImage = async (file?: File) => {
    if (!file) return
    const version = ++imageVersion.current
    setError('')
    setReadingImage(true)
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2_000_000) throw new Error('Choose a PNG, JPEG or WebP image up to 2 MB.')
      const bitmap = await createImageBitmap(file)
      const pixels = bitmap.width * bitmap.height
      bitmap.close()
      if (pixels > 20_000_000) throw new Error('Choose an image smaller than 20 megapixels.')
      if (version === imageVersion.current) setDetails(current => ({ ...current, image: file }))
    } catch (failure) {
      if (version === imageVersion.current) setError(failure instanceof Error && failure.message.startsWith('Choose') ? failure.message : 'This image could not be opened. Choose another PNG, JPEG or WebP file.')
    } finally { if (version === imageVersion.current) setReadingImage(false) }
  }
  return <section className="event-editor">
    <div className="event-editor-heading"><div><span className="home-eyebrow">YOUR EVENT STARTS HERE</span><h1 ref={heading} tabIndex={-1}>{previous ? 'Edit event' : 'Create event'}</h1></div><span className="badge b-outline">Unpublished draft</span></div>
    <div className="event-editor-grid">
      <form className="event-form" noValidate onSubmit={event => { event.preventDefault(); void save() }}>
        <fieldset disabled={saving}>
          <legend>Event details</legend>
          <label>Event name<input required maxLength={120} value={details.name} onChange={event => change('name', event.target.value)} placeholder="Give your event a name" /></label>
          <label>Description (optional)<textarea rows={4} maxLength={4000} value={details.description} onChange={event => change('description', event.target.value)} placeholder="What can your guests look forward to?" /></label>
          <div className="event-field-pair">
            <label>Event date<input required type="date" min="1900-01-01" max="9999-12-31" value={details.date} onChange={event => change('date', event.target.value)} /></label>
            <label>Start time<input required type="time" value={details.time} onChange={event => change('time', event.target.value)} /></label>
          </div>
          <TimezonePicker value={details.timezone} onChange={zone=>change('timezone',zone)} />
          <p id="event-zone-help" className="event-help">Search by city or region, then choose a timezone. New events start with UTC.</p>
          <label>Venue name<input required maxLength={160} value={details.venue} onChange={event => change('venue', event.target.value)} placeholder="Where is it happening?" /></label>
          <label>Venue address<input required maxLength={300} value={details.address} onChange={event => change('address', event.target.value)} placeholder="Street address and city" /></label>
          <label>Event image (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void loadImage(event.target.files?.[0]); event.target.value = '' }} aria-describedby="event-image-help" /></label>
          <p id="event-image-help" className="event-help">PNG, JPEG or WebP · Up to 2 MB. Saved with your event.</p>
          {details.image && <button type="button" className="event-text-button" onClick={() => { imageVersion.current++; setReadingImage(false); setDetails(current => ({ ...current, image: null })) }}>Remove image</button>}
        </fieldset>
        {error && <div className="event-error" role="alert" tabIndex={-1} ref={errorBox}>{error}</div>}
        {readingImage && <p role="status">Preparing your image…</p>}
        <div className="actions"><button className="btn primary" aria-label={saving ? 'Saving draft' : 'Save draft'} disabled={saving || readingImage}>{saving ? 'Saving…' : 'Save draft'}</button><button type="button" className="btn" disabled={saving} onClick={() => { if (!dirty || window.confirm('Discard your unsaved changes?')) onCancel() }}>Cancel</button></div>
      </form>
      <aside className="event-preview" role="region" aria-label="Event preview"><span className="home-eyebrow">LIVE PREVIEW</span><article><EventCover image={details.image} name={details.name} /><div className="event-preview-body"><span className="badge b-outline">Draft · Not published</span><h3>{details.name.trim() || 'Your next event.'}</h3><p className="event-when">{eventDate(details.date)}{details.time && ` · ${details.time}`}<br />{details.timezone}</p><h4>{details.venue.trim() || 'Your venue'}</h4><p>{details.address || 'Venue address'}</p>{details.description && <p className="event-description">{details.description}</p>}</div></article><p className="event-help">Saving a draft does not issue tickets or publish an event. Your sign-in identifies the organiser; saving does not request a wallet signature.</p></aside>
    </div>
  </section>
}

export function VenueEvents(): React.JSX.Element {
  const [publishing, setPublishing] = useState<AccountEvent | null>(null)
  const [issuing, setIssuing] = useState<AccountEvent | null>(null)
  const [events, setEvents] = useState<AccountEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState<{ previous?: EventDraft } | null>(null)
  const [notice, setNotice] = useState('')
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const editVersion = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [reload, setReload] = useState(0)
  const createButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    listEventDrafts().then(result => { if (active) { setEvents(result.events); setNextOffset(result.nextOffset) } }).catch(() => {
      if (active) setError('Your events could not be loaded. Check your connection and try again.')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])
  const edit = async (id: string) => {
    const version = ++editVersion.current
    setError('')
    try { const previous = await getAccountEvent(id); if (mounted.current && version === editVersion.current) { setNotice(''); setEditor({ previous }) } }
    catch (failure) { if (mounted.current && version === editVersion.current) setError((failure as Error).message) }
  }
  const more = async () => {
    if (nextOffset === null || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await listEventDrafts(nextOffset)
      if (mounted.current) { setEvents(current => [...current, ...result.events.filter(item => !current.some(existing => existing.id === item.id))]); setNextOffset(result.nextOffset) }
    } catch (failure) { if (mounted.current) setError((failure as Error).message) }
    finally { if (mounted.current) setLoadingMore(false) }
  }
  const finish = () => { editVersion.current++; setEditor(null); requestAnimationFrame(() => createButton.current?.focus()) }
  if (publishing) return <VenuePublication event={publishing} onClose={() => { setPublishing(null); setReload(value => value + 1) }} />
  if (issuing) return <VenueIssuance event={issuing} onClose={() => { setIssuing(null); setReload(value => value + 1) }} />
  return <div className="venue-events">
    {editor ? <EventEditor key={editor.previous?.id ?? 'new'} previous={editor.previous} onCancel={finish} onSaved={saved => {
      setEvents(current => [saved, ...current.filter(event => event.id !== saved.id)])
      setNotice('Draft saved to your account. No tickets have been issued.')
      finish()
    }} /> : <>
      <div className="event-list-heading"><div><span className="home-eyebrow"><DashboardIcon name="sparkle"/> THE ORGANISER WORKSPACE</span><h1>Your <em>events.</em></h1><p>Make something worth showing up for. Create, publish and manage your events here.</p></div><button ref={createButton} aria-label="Create event" className="btn primary" disabled={loading || Boolean(error)} onClick={() => { editVersion.current++; setNotice(''); setEditor({}) }}><span aria-hidden="true">＋</span> Create event</button></div>
      <div className="event-collection-bar"><div><DashboardIcon name="calendar"/><h2>My events</h2>{!loading&&!error&&<span className="event-count">{events.length}{nextOffset!==null?'+':''}</span>}</div><p>Drafts stay private until you publish them. <a href="/scanner">Open entrance scanner ↗</a></p></div>
      {notice && <p className="event-saved" role="status">{notice}</p>}
      {loading ? <p role="status">Loading saved events…</p> : error ? <div className="event-error" role="alert">{error}<button className="btn" onClick={() => setReload(value => value + 1)}>Try again</button></div> : events.length === 0 ? <div className="event-empty"><span aria-hidden="true">✳</span><h3>Your first event starts here.</h3><p>Add the details, choose an image, and save your event draft.</p><p className="event-help">Save an event to review and issue its first ticket.</p></div> : <div className="event-grid">{events.map(event => <article className="event-card" key={event.id}><EventCover image={event.image} coverUrl={event.coverUrl} name={event.name} /><div className="event-card-body"><span className="badge b-outline">Saved version {event.revision}</span><h3>{event.name}</h3><p className="event-card-meta"><DashboardIcon name="calendar"/><span>{eventDate(event.date)} · {event.time}<br /><span className="event-help">{event.timezone}</span></span></p><p className="event-card-meta"><DashboardIcon name="pin"/><span>{event.venue}<br /><span className="event-help">{event.address}</span></span></p><details className="event-reference"><summary>Event reference</summary><code>{event.id}</code></details><div className="event-card-actions"><button className="btn" aria-label={`Edit ${event.name}`} onClick={() => void edit(event.id)}><DashboardIcon name="grid"/>Edit event</button><button className="btn" aria-label={`Manage publication for ${event.name}`} onClick={() => { setNotice(''); void getAccountEvent(event.id).then(value => { if (mounted.current) setPublishing(value) }).catch(e => { if (mounted.current) setError(e.message) }) }}><DashboardIcon name="explore"/>Publication</button><button className="btn primary" aria-label={`Tickets for ${event.name}`} onClick={() => { editVersion.current++; setIssuing(event) }}><DashboardIcon name="ticket"/>Issue ticket</button></div></div></article>)}</div>}
      {!loading && !error && nextOffset !== null && <button className="btn" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? 'Loading…' : 'Load more events'}</button>}
    </>}
  </div>
}
