import type { Express } from 'express'
import type { Pool } from 'pg'
import { ApiError } from './events.ts'
import { requestsCloseAt } from './event-close.ts'
import { issuanceRecord } from './issuances.ts'
import { validUUID, verifyRequestProof } from '../src/marketplace/request-proof.ts'
import type { PublishedEvent } from '../src/marketplace/types.ts'

// Closing instants are computed in Node at publication, so reads only compare
// timestamps. Listings never load cover images; only the cover route does.
const requestsOpen = 'COALESCE(requests_close_at > to_timestamp($1 / 1000.0), false)'
const summary = `event_id, revision, owner_key, details - 'image' AS details, COALESCE(details->'image' <> 'null'::jsonb, false) AS has_image, ${requestsOpen} AS requests_open`
function published(row: Record<string, any>): PublishedEvent {
  return {
    ...row.details,
    id: row.event_id,
    revision: row.revision,
    venueIdentity: row.owner_key,
    requestsOpen: row.requests_open,
    ...(row.has_image ? { coverUrl: `/api/marketplace/events/${row.event_id}/cover` } : {}),
  } as PublishedEvent
}
function requested(row: Record<string, any>) {
  return {
    id: row.id,
    eventId: row.event_id,
    event: { ...row.event_details, id: row.event_id, revision: row.event_revision, venueIdentity: row.venue_key },
    proof: row.proof,
    createdAt: new Date(row.created_at).toISOString(),
    ticketId: row.ticket_id ?? null,
    status: row.ticket_status ?? 'requested',
  }
}
function offsetOf(value: unknown): number {
  const offset = value === undefined ? 0 : Number(value)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new ApiError(400, 'Invalid page.')
  return offset
}
export function marketplaceRoutes(app: Express, pool: Pool, now: () => number) {
  app.get('/api/marketplace/events', async (req, res) => {
    const offset = offsetOf(req.query.offset)
    const result = await pool.query(
      `SELECT ${summary} FROM event_publications WHERE published ORDER BY requests_open DESC, details->>'date', details->>'time', event_id LIMIT 25 OFFSET $2`,
      [now(), offset],
    )
    res.json({ events: result.rows.slice(0, 24).map(published), nextOffset: result.rows.length > 24 ? offset + 24 : null })
  })
  app.get('/api/marketplace/events/:id/cover', async (req, res) => {
    if (!validUUID(req.params.id)) throw new ApiError(404, 'Event not found.')
    const row = (
      await pool.query("SELECT details->'image' AS image FROM event_publications WHERE event_id=$1 AND published", [req.params.id])
    ).rows[0]
    if (!row) throw new ApiError(404, 'This event is not published.')
    if (!row.image) throw new ApiError(404, 'Image not found.')
    res.type(row.image.type).send(Buffer.from(row.image.data, 'base64'))
  })
  app.get('/api/marketplace/events/:id', async (req, res) => {
    if (!validUUID(req.params.id)) throw new ApiError(404, 'Event not found.')
    const row = (await pool.query(`SELECT ${summary} FROM event_publications WHERE event_id=$2 AND published`, [now(), req.params.id]))
      .rows[0]
    if (!row) throw new ApiError(404, 'This event is not published.')
    // Event details stay reachable after their date; new requests are refused below.
    res.json(published(row))
  })
  app.post('/api/events/:id/publication', async (req, res) => {
    if (!validUUID(req.params.id) || typeof req.body.published !== 'boolean' || !Number.isSafeInteger(req.body.revision))
      throw new ApiError(400, 'Invalid publication review.')
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      const event = (
        await db.query('SELECT * FROM organiser_events WHERE id=$1 AND owner_key=$2 FOR UPDATE', [req.params.id, res.locals.owner])
      ).rows[0]
      if (!event) throw new ApiError(404, 'Event not found.')
      if (event.revision !== req.body.revision) throw new ApiError(409, 'The event changed. Reload and review before publishing.')
      let closeAt: Date
      try {
        closeAt = requestsCloseAt(event.details.date, event.details.timezone)
      } catch {
        throw new ApiError(400, 'Choose a valid timezone, such as UTC, Europe/Madrid or America/New_York, then publish again.')
      }
      await db.query(
        'INSERT INTO event_publications(event_id,owner_key,revision,details,published,requests_close_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO UPDATE SET revision=EXCLUDED.revision,details=EXCLUDED.details,published=EXCLUDED.published,requests_close_at=EXCLUDED.requests_close_at,published_at=now()',
        [event.id, res.locals.owner, event.revision, event.details, req.body.published, closeAt],
      )
      await db.query('COMMIT')
      res.json({ published: req.body.published, revision: event.revision })
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    } finally {
      db.release()
    }
  })
  // Every request across the organiser's events whose ticket isn't issued yet. limit=0 returns only the count.
  app.get('/api/events/requests/waiting', async (req, res) => {
    const limit = req.query.limit === undefined ? 100 : Number(req.query.limit)
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100) throw new ApiError(400, 'Invalid request limit.')
    const waiting =
      "FROM attendee_requests r LEFT JOIN venue_issuances i ON i.attendee_request_id=r.id WHERE r.venue_key=$1 AND i.status IS DISTINCT FROM 'complete'"
    if (!limit) {
      res.json({ total: (await pool.query(`SELECT count(*)::int AS total ${waiting}`, [res.locals.owner])).rows[0].total, requests: [] })
      return
    }
    const rows = (
      await pool.query(
        `SELECT r.*, i.id AS ticket_id, i.status AS ticket_status, count(*) OVER ()::int AS total ${waiting} ORDER BY r.created_at DESC,r.id LIMIT $2`,
        [res.locals.owner, limit],
      )
    ).rows
    res.json({ total: rows[0]?.total ?? 0, requests: rows.map(requested) })
  })
  app.get('/api/events/:id/requests', async (req, res) => {
    if (
      !validUUID(req.params.id) ||
      !(await pool.query('SELECT id FROM organiser_events WHERE id=$1 AND owner_key=$2', [req.params.id, res.locals.owner])).rowCount
    )
      throw new ApiError(404, 'Event not found.')
    const offset = offsetOf(req.query.offset)
    const rows = (
      await pool.query(
        'SELECT r.*, i.id AS ticket_id, i.status AS ticket_status FROM attendee_requests r LEFT JOIN venue_issuances i ON i.attendee_request_id=r.id WHERE r.event_id=$1 AND r.venue_key=$2 ORDER BY r.created_at DESC,r.id LIMIT 26 OFFSET $3',
        [req.params.id, res.locals.owner, offset],
      )
    ).rows
    res.json({ requests: rows.slice(0, 25).map(requested), nextOffset: rows.length > 25 ? offset + 25 : null })
  })
  app.get('/api/tickets/requests', async (req, res) => {
    const offset = offsetOf(req.query.offset)
    if (req.query.eventId !== undefined && !validUUID(req.query.eventId)) throw new ApiError(400, 'Invalid event.')
    const rows = (
      await pool.query(
        'SELECT r.*, i.id AS ticket_id, i.status AS ticket_status FROM attendee_requests r LEFT JOIN venue_issuances i ON i.attendee_request_id=r.id WHERE r.attendee_key=$1 AND ($3::uuid IS NULL OR r.event_id=$3) ORDER BY r.created_at DESC,r.id LIMIT 26 OFFSET $2',
        [res.locals.owner, offset, req.query.eventId ?? null],
      )
    ).rows
    res.json({ requests: rows.slice(0, 25).map(requested), nextOffset: rows.length > 25 ? offset + 25 : null })
  })
  app.post('/api/tickets/requests', async (req, res) => {
    let proof
    try {
      proof = verifyRequestProof(req.body.proof, {
        eventId: req.body.proof.eventId,
        revision: req.body.proof.revision,
        venue: req.body.proof.venue,
        attendee: res.locals.owner,
        origin: res.locals.origin,
      })
    } catch {
      throw new ApiError(400, 'The receiving-key signature does not match this account, event and website.')
    }
    if (proof.venue === res.locals.owner) throw new ApiError(409, "You organise this event, so you can't request a ticket for it.")
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      // Serialize publication changes and all requests for this event.
      const publication = (await db.query('SELECT * FROM event_publications WHERE event_id=$1 FOR UPDATE', [proof.eventId])).rows[0]
      const existing = (
        await db.query('SELECT * FROM attendee_requests WHERE event_id=$1 AND attendee_key=$2', [proof.eventId, res.locals.owner])
      ).rows[0]
      if (existing) {
        await db.query('COMMIT')
        res.json(requested(existing))
        return
      }
      if (!publication?.published || publication.owner_key !== proof.venue || publication.revision !== proof.revision)
        throw new ApiError(409, 'This event publication changed. Reload the event before requesting.')
      const eligible = await db.query(`SELECT event_id FROM event_publications WHERE event_id=$2 AND ${requestsOpen}`, [
        now(),
        proof.eventId,
      ])
      if (!eligible.rowCount) throw new ApiError(409, 'This event date has passed. New requests are closed.')
      const { image: _image, ...details } = publication.details
      const inserted = await db.query(
        'INSERT INTO attendee_requests(id,event_id,attendee_key,venue_key,event_revision,event_details,proof) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *',
        [proof.request.requestId, proof.eventId, res.locals.owner, proof.venue, proof.revision, details, proof],
      )
      if (!inserted.rowCount) throw new ApiError(409, 'This receiving request is already in use.')
      await db.query('COMMIT')
      res.status(201).json(requested(inserted.rows[0]))
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    } finally {
      db.release()
    }
  })
  app.get('/api/tickets', async (req, res) => {
    const offset = offsetOf(req.query.offset)
    const rows = (
      await pool.query(
        "SELECT i.id,i.event_id,i.owner_key,i.event_revision,i.event_details,i.request,i.status,i.txid,i.created_at,i.updated_at FROM venue_issuances i JOIN attendee_requests r ON r.id=i.attendee_request_id WHERE r.attendee_key=$1 AND i.status='complete' ORDER BY i.created_at DESC,i.id LIMIT 26 OFFSET $2",
        [res.locals.owner, offset],
      )
    ).rows
    res.json({
      tickets: rows.slice(0, 25).map(row => {
        const { pkg: _pkg, ...summary } = issuanceRecord(row)
        return summary
      }),
      nextOffset: rows.length > 25 ? offset + 25 : null,
    })
  })
  app.get('/api/tickets/:id', async (req, res) => {
    const eventId = req.query.eventId
    if (!validUUID(req.params.id) || (eventId !== undefined && !validUUID(eventId))) throw new ApiError(404, 'Ticket not found.')
    // Ticket IDs are unique per organiser, so the event picks the ticket.
    // Without it, an ID two organisers share matches nothing.
    const rows = (
      await pool.query(
        "SELECT i.*, r.proof AS attendee_proof FROM venue_issuances i JOIN attendee_requests r ON r.id=i.attendee_request_id WHERE i.id=$1 AND r.attendee_key=$2 AND ($3::uuid IS NULL OR i.event_id=$3) AND i.status='complete' LIMIT 2",
        [req.params.id, res.locals.owner, eventId ?? null],
      )
    ).rows
    if (rows.length !== 1) throw new ApiError(404, 'Ticket not found.')
    res.json(issuanceRecord(rows[0]))
  })
}
