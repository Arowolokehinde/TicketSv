import { DashboardIcon } from './DashboardIcon.tsx'
import { useEffect, useState } from 'react'
import { api } from '../auth/api.ts'
import type { AttendeeRequest } from '../marketplace/types.ts'
export function VenueRequests({
  eventId,
  disabled,
  onReview,
}: {
  eventId: string
  disabled: boolean
  onReview: (request: AttendeeRequest) => void
}) {
  const [requests, setRequests] = useState<AttendeeRequest[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [next, setNext] = useState<number | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setBusy(true)
    setError('')
    void api<{ requests: AttendeeRequest[]; nextOffset: number | null }>(`/api/events/${eventId}/requests`)
      .then(result => {
        if (active) {
          setRequests(result.requests ?? [])
          setNext(result.nextOffset ?? null)
        }
      })
      .catch(e => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [eventId, reload])
  async function more() {
    if (next === null || busy) return
    setBusy(true)
    try {
      const result = await api<{ requests: AttendeeRequest[]; nextOffset: number | null }>(`/api/events/${eventId}/requests?offset=${next}`)
      setRequests(items => [...items, ...result.requests.filter(r => !items.some(i => i.id === r.id))])
      setNext(result.nextOffset)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const status = { requested: 'Awaiting review', prepared: 'Ready to issue', pending: 'In progress', complete: 'Issued' }
  return (
    <section className="venue-inbox issuance-panel issuance-requests" aria-labelledby="attendee-requests-heading">
      <div className="issuance-panel-heading">
        <div>
          <h2 id="attendee-requests-heading">
            Attendee requests{' '}
            <span className="issuance-count" aria-hidden="true">
              {requests.length}
              {next !== null ? '+' : ''}
            </span>
          </h2>
          <p>Review a request to issue a ticket.</p>
        </div>
        <button
          className="btn issuance-refresh"
          aria-label="Refresh requests"
          disabled={disabled || busy}
          onClick={() => setReload(n => n + 1)}
        >
          <DashboardIcon name="refresh" />
          <span>Refresh</span>
        </button>
      </div>
      {busy && <p role="status">Loading requests…</p>}
      {error && (
        <p className="event-error" role="alert">
          {error}
        </p>
      )}
      {!busy && !error && !requests.length && (
        <div className="issuance-empty">
          <span className="issuance-empty-icon">
            <DashboardIcon name="ticket" />
          </span>
          <h3>No requests yet</h3>
          <p>Attendee requests will appear here.</p>
        </div>
      )}
      <div className="request-list">
        {requests.map(request => (
          <article key={request.id}>
            <div className="issuance-request-info">
              <div className="issuance-request-title">
                <strong>Request #{request.id.slice(0, 8)}</strong>
                <span className={`issuance-status issuance-status-${request.status}`}>{status[request.status]}</span>
              </div>
              <p className="issuance-request-date">{new Date(request.createdAt).toLocaleString()}</p>
              <details>
                <summary>Recipient details</summary>
                <p>Wallet identity</p>
                <code>{request.proof.attendee}</code>
                <p>Receiving key</p>
                <code>{request.proof.request.recipient.publicKey}</code>
                <p>Event revision {request.event.revision}</p>
              </details>
            </div>
            <button
              className="btn primary"
              aria-label={request.ticketId ? 'Open ticket record' : 'Review new issuance'}
              disabled={disabled || busy}
              onClick={() => onReview(request)}
            >
              {request.ticketId ? 'Open ticket' : 'Review request'}
              <DashboardIcon name="arrow" />
            </button>
          </article>
        ))}
      </div>
      {next !== null && (
        <button className="btn" disabled={busy || disabled} onClick={() => void more()}>
          More requests
        </button>
      )}
    </section>
  )
}
