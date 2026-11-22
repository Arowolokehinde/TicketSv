import { useEffect, useRef, useState } from 'react'
import { getAccountEvent, listAccountEvents, waitingRequests, type AccountEvent } from '../events/api.ts'
import { publicationLabel } from '../events/publication.ts'
import type { AttendeeRequest } from '../marketplace/types.ts'
import { DashboardIcon } from './DashboardIcon.tsx'
import { EventCover, EventEditor, eventDate } from './VenueEvents.tsx'
import { VenueIssuance } from './VenueIssuance.tsx'
import { VenuePublication } from './VenuePublication.tsx'
import { WAITING_EVENT } from './Workspace.tsx'
import '../styles/my-events.css'

const status = { requested: 'Awaiting review', prepared: 'Ready to issue', pending: 'In progress', complete: 'Issued' }
const short = (key: string) => `${key.slice(0, 6)}…${key.slice(-6)}`
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function WaitingList({ requests, onReview }: { requests: AttendeeRequest[]; onReview: (request: AttendeeRequest) => void }) {
  return (
    <ul className="my-events-requests">
      {requests.map(request => (
        <li key={request.id}>
          <div>
            <strong>Requester {short(request.proof.attendee)}</strong>
            <span className={`issuance-status issuance-status-${request.status}`}>{status[request.status]}</span>
            <p className="event-help">Asked {new Date(request.createdAt).toLocaleString()}</p>
          </div>
          <button
            className="btn primary"
            aria-label={`Review request from ${short(request.proof.attendee)}`}
            onClick={() => onReview(request)}
          >
            Review
          </button>
        </li>
      ))}
    </ul>
  )
}

// Every event the organiser has saved, once, with everything about it: details, publication,
// waiting requests and issued tickets. Create event only creates.
export function MyEvents(): React.JSX.Element {
  const [events, setEvents] = useState<AccountEvent[]>([]),
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [requests, setRequests] = useState<AttendeeRequest[]>([]),
    [loading, setLoading] = useState(true),
    [loadingMore, setLoadingMore] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(() =>
      new URLSearchParams(location.search).has('saved') ? 'Draft saved to your account. No tickets have been issued.' : '',
    ),
    [reload, setReload] = useState(0),
    [editing, setEditing] = useState<AccountEvent>(),
    [publishing, setPublishing] = useState<AccountEvent>(),
    [issuing, setIssuing] = useState<{ event: AccountEvent; review?: AttendeeRequest }>(),
    [requestsFailed, setRequestsFailed] = useState(false)
  const mounted = useRef(true),
    openVersion = useRef(0)
  useEffect(() => {
    mounted.current = true
    // The saved notice is shown once; a reload shouldn't repeat it.
    if (location.search) history.replaceState(history.state, '', location.pathname)
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    // Both load together; if only the requests fail, the events still show.
    Promise.all([listAccountEvents(), waitingRequests().catch(() => undefined)])
      .then(([list, waiting]) => {
        if (!active) return
        setEvents(list.events)
        setNextOffset(list.nextOffset)
        setRequests(waiting?.requests ?? [])
        setRequestsFailed(!waiting)
        if (waiting) window.dispatchEvent(new CustomEvent(WAITING_EVENT, { detail: waiting.total }))
      })
      .catch(() => {
        if (active) setError('Your events could not be loaded. Check your connection and try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [reload])
  // Edit needs the event's cover image, which the list leaves out. The latest choice wins over a slower earlier one.
  async function open(id: string, then: (event: AccountEvent) => void, known?: AccountEvent) {
    const version = ++openVersion.current
    setError('')
    setNotice('')
    try {
      const event = known ?? (await getAccountEvent(id))
      if (mounted.current && version === openVersion.current) then(event)
    } catch (failure) {
      if (mounted.current && version === openVersion.current) setError((failure as Error).message)
    }
  }
  const review = (request: AttendeeRequest) =>
    void open(request.eventId, event => setIssuing({ event, review: request }), events.find(item => item.id === request.eventId))
  async function more() {
    if (nextOffset === null || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await listAccountEvents(nextOffset)
      if (mounted.current) {
        setEvents(current => [...current, ...result.events.filter(item => !current.some(existing => existing.id === item.id))])
        setNextOffset(result.nextOffset)
      }
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message)
    } finally {
      if (mounted.current) setLoadingMore(false)
    }
  }

  if (editing)
    return (
      <div className="venue-events">
        <EventEditor
          previous={editing}
          onCancel={() => setEditing(undefined)}
          onSaved={saved => {
            setEvents(current => current.map(event => (event.id === saved.id ? saved : event)))
            setNotice('Draft saved to your account. No tickets have been issued.')
            setEditing(undefined)
          }}
        />
      </div>
    )
  if (publishing)
    return (
      <VenuePublication
        event={publishing}
        onClose={publication => {
          const id = publishing.id
          setPublishing(undefined)
          setEvents(current => current.map(event => (event.id === id ? { ...event, publication } : event)))
        }}
      />
    )
  if (issuing)
    return (
      <VenueIssuance
        event={issuing.event}
        review={issuing.review}
        onClose={() => {
          setIssuing(undefined)
          setReload(value => value + 1)
        }}
      />
    )

  const waitingFor = (id: string) => requests.filter(request => request.eventId === id)
  // Events with waiting requests first, keeping their saved order otherwise.
  const ordered = [...events].sort((a, b) => Number(waitingFor(b.id).length > 0) - Number(waitingFor(a.id).length > 0))
  // Requests for an event beyond the loaded page are still shown, by the details they were requested with.
  const elsewhere = requests.filter(request => !events.some(event => event.id === request.eventId))
  return (
    <div className="venue-events my-events">
      <div className="event-list-heading">
        <div>
          <span className="home-eyebrow">
            <DashboardIcon name="ticket" /> THE ORGANISER WORKSPACE
          </span>
          <h1>My events</h1>
          <p>Your events, their ticket requests and issued tickets. Drafts stay private until you publish them.</p>
        </div>
        <div className="my-events-actions">
          <button className="btn" disabled={loading} onClick={() => setReload(value => value + 1)}>
            <DashboardIcon name="refresh" /> Refresh
          </button>
          <a className="btn primary" href="/venue">
            <span aria-hidden="true">＋</span> Create event
          </a>
        </div>
      </div>
      {notice && (
        <p className="event-saved" role="status">
          {notice}
        </p>
      )}
      {loading && <p role="status">Loading your events…</p>}
      {requestsFailed && !loading && (
        <p className="event-error" role="alert">
          Ticket requests could not be loaded. Select Refresh to try again.
        </p>
      )}
      {error && (
        <div className="event-error" role="alert">
          {error}
          <button className="btn" onClick={() => setReload(value => value + 1)}>
            Try again
          </button>
        </div>
      )}
      {!loading && !error && !events.length && !elsewhere.length && (
        <div className="event-empty">
          <span aria-hidden="true">✳</span>
          <h3>You haven't created an event yet.</h3>
          <p>
            <a href="/venue">Create event</a> to start taking ticket requests.
          </p>
        </div>
      )}
      {!loading && (
        <div className="event-grid">
          {ordered.map(event => {
            const waiting = waitingFor(event.id)
            return (
              <article className="event-card my-events-event" key={event.id} aria-label={event.name}>
                <EventCover image={event.image} coverUrl={event.coverUrl} name={event.name} />
                <div className="event-card-body">
                  <span className="badge b-outline">{publicationLabel(event.revision, event.publication)}</span>
                  <h3>{event.name}</h3>
                  <p className="event-card-meta">
                    <DashboardIcon name="calendar" />
                    <span>
                      {eventDate(event.date)} · {event.time}
                      <br />
                      <span className="event-help">{event.timezone}</span>
                    </span>
                  </p>
                  <p className="event-card-meta">
                    <DashboardIcon name="pin" />
                    <span>
                      {event.venue}
                      <br />
                      <span className="event-help">{event.address}</span>
                    </span>
                  </p>
                  <p className="my-events-summary">
                    {waiting.length ? `${waiting.length} waiting` : 'No requests waiting'} · {plural(event.issued, 'ticket')} issued
                  </p>
                  {waiting.length > 0 && <WaitingList requests={waiting} onReview={review} />}
                  <details className="event-reference">
                    <summary>Event reference</summary>
                    <code>{event.id}</code>
                  </details>
                  <div className="event-card-actions">
                    <button className="btn" aria-label={`Edit ${event.name}`} onClick={() => void open(event.id, setEditing)}>
                      <DashboardIcon name="grid" />
                      Edit event
                    </button>
                    <button
                      className="btn"
                      aria-label={`Manage publication for ${event.name}`}
                      onClick={() => void open(event.id, setPublishing, event)}
                    >
                      <DashboardIcon name="explore" />
                      Publication
                    </button>
                    <button
                      className="btn primary"
                      aria-label={`Tickets for ${event.name}`}
                      onClick={() => void open(event.id, value => setIssuing({ event: value }), event)}
                    >
                      <DashboardIcon name="ticket" />
                      Issue ticket
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
      {!loading && elsewhere.length > 0 && (
        <section className="my-events-elsewhere" aria-label="Requests for other events">
          <h2>Requests for your other events</h2>
          <WaitingList requests={elsewhere} onReview={review} />
        </section>
      )}
      {!loading && !error && nextOffset !== null && (
        <button className="btn" disabled={loadingMore} onClick={() => void more()}>
          {loadingMore ? 'Loading…' : 'Load more events'}
        </button>
      )}
    </div>
  )
}
