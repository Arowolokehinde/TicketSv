import { useEffect, useRef, useState } from 'react'
import { validateEventDetails, type EventDetails } from '../events/drafts.ts'
import { type AccountEvent, saveAccountEvent as saveEventDraft } from '../events/api.ts'
import { publicationLabel } from '../events/publication.ts'
import { navigateOnline } from '../navigation/location.ts'
import '../styles/venue.css'
import '../styles/marketplace.css'
import { TimezonePicker } from './TimezonePicker.tsx'
import { StartTimePicker } from './StartTimePicker.tsx'

function useCover(image: Blob | null): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!image) {
      setUrl(undefined)
      return
    }
    const next = URL.createObjectURL(image)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [image])
  return url
}

export function eventDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Date to be confirmed'
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed)
    : 'Date to be confirmed'
}

export function EventCover({ image, name, coverUrl }: { image: Blob | null; name: string; coverUrl?: string }): React.JSX.Element {
  const blobUrl = useCover(image)
  const url = blobUrl ?? coverUrl
  return (
    <div className="event-cover">
      {url ? (
        <img src={url} alt={`Cover for ${name || 'your event'}`} />
      ) : (
        <div className="event-cover-art" aria-hidden="true">
          <span>TicketSV / EVENT</span>
          <svg viewBox="0 0 160 110" fill="none">
            <path d="M15 20h130v22a13 13 0 0 0 0 26v22H15V68a13 13 0 0 0 0-26Z" />
            <path d="M110 20v70" strokeDasharray="4 5" />
            <path d="M35 43h50M35 56h35M35 69h43" />
          </svg>
          <em>Something to look forward to.</em>
        </div>
      )}
    </div>
  )
}

export function EventEditor({
  previous,
  onSaved,
  onCancel,
}: {
  previous?: AccountEvent
  onSaved: (event: AccountEvent) => void
  onCancel: () => void
}): React.JSX.Element {
  const [requestId] = useState(() => crypto.randomUUID())
  const [initial] = useState<EventDetails>(
    () => previous ?? { name: '', description: '', date: '', time: '', timezone: 'UTC', venue: '', address: '', image: null },
  )
  const [details, setDetails] = useState<EventDetails>(initial)
  const status = previous ? publicationLabel(previous.revision, previous.publication) : 'Not published'
  const [saving, setSaving] = useState(false)
  const [readingImage, setReadingImage] = useState(false)
  const [error, setError] = useState('')
  const errorBox = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const imageVersion = useRef(0)
  const savingRef = useRef(false)
  const dirty = (Object.keys(initial) as (keyof EventDetails)[]).some(key => initial[key] !== details[key])
  useEffect(() => {
    heading.current?.focus()
    return () => {
      imageVersion.current++
    }
  }, [])
  useEffect(() => {
    if (error) errorBox.current?.focus()
  }, [error])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const change = (key: keyof Omit<EventDetails, 'image'>, value: string) => setDetails(current => ({ ...current, [key]: value }))
  const save = async () => {
    if (savingRef.current || readingImage) return
    setError('')
    let valid: EventDetails
    try {
      valid = validateEventDetails(details)
    } catch (failure) {
      setError((failure as Error).message)
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      onSaved(await saveEventDraft(valid, previous, requestId))
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : ''
      setError(message || 'The draft could not be saved. Your form is still here. Please try again.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }
  const loadImage = async (file?: File) => {
    if (!file) return
    const version = ++imageVersion.current
    setError('')
    setReadingImage(true)
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2_000_000)
        throw new Error('Choose a PNG, JPEG or WebP image up to 2 MB.')
      const bitmap = await createImageBitmap(file)
      const pixels = bitmap.width * bitmap.height
      bitmap.close()
      if (pixels > 20_000_000) throw new Error('Choose an image smaller than 20 megapixels.')
      if (version === imageVersion.current) setDetails(current => ({ ...current, image: file }))
    } catch (failure) {
      if (version === imageVersion.current)
        setError(
          failure instanceof Error && failure.message.startsWith('Choose')
            ? failure.message
            : 'This image could not be opened. Choose another PNG, JPEG or WebP file.',
        )
    } finally {
      if (version === imageVersion.current) setReadingImage(false)
    }
  }
  return (
    <section className="event-editor">
      <div className="event-editor-heading">
        <div>
          <span className="home-eyebrow">YOUR EVENT STARTS HERE</span>
          <h1 ref={heading} tabIndex={-1}>
            {previous ? 'Edit event' : 'Create event'}
          </h1>
        </div>
        <span className="badge b-outline">{status}</span>
      </div>
      <div className="event-editor-grid">
        <form
          className="event-form"
          noValidate
          onSubmit={event => {
            event.preventDefault()
            void save()
          }}
        >
          <fieldset disabled={saving}>
            <legend>Event details</legend>
            <label>
              Event name
              <input
                required
                maxLength={120}
                value={details.name}
                onChange={event => change('name', event.target.value)}
                placeholder="Give your event a name"
              />
            </label>
            <label>
              Description (optional)
              <textarea
                rows={4}
                maxLength={4000}
                value={details.description}
                onChange={event => change('description', event.target.value)}
                placeholder="What can your guests look forward to?"
              />
            </label>
            <div className="event-field-pair">
              <label>
                Event date
                <input
                  required
                  type="date"
                  min="1900-01-01"
                  max="9999-12-31"
                  value={details.date}
                  onChange={event => change('date', event.target.value)}
                />
              </label>
              <StartTimePicker value={details.time} onChange={time => change('time', time)} />
            </div>
            <TimezonePicker value={details.timezone} onChange={zone => change('timezone', zone)} />
            <p id="event-zone-help" className="event-help">
              Search by city or region, then choose a timezone. New events start with UTC.
            </p>
            <label>
              Venue name
              <input
                required
                maxLength={160}
                value={details.venue}
                onChange={event => change('venue', event.target.value)}
                placeholder="Where is it happening?"
              />
            </label>
            <label>
              Venue address
              <input
                required
                maxLength={300}
                value={details.address}
                onChange={event => change('address', event.target.value)}
                placeholder="Street address and city"
              />
            </label>
            <label>
              Event image (optional)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={event => {
                  void loadImage(event.target.files?.[0])
                  event.target.value = ''
                }}
                aria-describedby="event-image-help"
              />
            </label>
            <p id="event-image-help" className="event-help">
              PNG, JPEG or WebP · Up to 2 MB. Saved with your event.
            </p>
            {details.image && (
              <button
                type="button"
                className="event-text-button"
                onClick={() => {
                  imageVersion.current++
                  setReadingImage(false)
                  setDetails(current => ({ ...current, image: null }))
                }}
              >
                Remove image
              </button>
            )}
          </fieldset>
          {error && (
            <div className="event-error" role="alert" tabIndex={-1} ref={errorBox}>
              {error}
            </div>
          )}
          {readingImage && <p role="status">Preparing your image…</p>}
          <div className="actions">
            <button className="btn primary" aria-label={saving ? 'Saving draft' : 'Save draft'} disabled={saving || readingImage}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => {
                if (!dirty || window.confirm('Discard your unsaved changes?')) onCancel()
              }}
            >
              Cancel
            </button>
          </div>
        </form>
        <aside className="event-preview" role="region" aria-label="Event preview">
          <span className="home-eyebrow">LIVE PREVIEW</span>
          <article>
            <EventCover image={details.image} name={details.name} />
            <div className="event-preview-body">
              <span className="badge b-outline">{status}</span>
              <h3>{details.name.trim() || 'Your next event.'}</h3>
              <p className="event-when">
                {eventDate(details.date)}
                {details.time && ` · ${details.time}`}
                <br />
                {details.timezone}
              </p>
              <h4>{details.venue.trim() || 'Your venue'}</h4>
              <p>{details.address || 'Venue address'}</p>
              {details.description && <p className="event-description">{details.description}</p>}
            </div>
          </article>
          <p className="event-help">
            Saving a draft does not issue tickets or publish an event. Your sign-in identifies the organiser; saving does not request a
            wallet signature.
          </p>
        </aside>
      </div>
    </section>
  )
}

// Create event only creates. Saving or cancelling goes to My events, where every event is managed.
export function CreateEvent(): React.JSX.Element {
  const go = (destination: string) => {
    if (!navigateOnline(destination)) location.assign(destination)
  }
  return (
    <div className="venue-events">
      <EventEditor onCancel={() => go('/venue/my-events')} onSaved={() => go('/venue/my-events?saved=1')} />
    </div>
  )
}
