import type { Express } from 'express'
import type { Pool } from 'pg'
import { ApiError } from './events.ts'
import { issuanceRecord } from './issuances.ts'
import { validUUID, verifyRequestProof } from '../src/marketplace/request-proof.ts'
import type { PublishedEvent } from '../src/marketplace/types.ts'

const currentEvent = "(details->>'date')::date >= (to_timestamp($1 / 1000.0) AT TIME ZONE (details->>'timezone'))::date"
function published(row: Record<string, any>): PublishedEvent {
 const { image, ...details } = row.details
 return { ...details, id: row.event_id, revision: row.revision, venueIdentity: row.owner_key, requestsOpen: row.requests_open, ...(image ? { coverUrl: `/api/marketplace/events/${row.event_id}/cover` } : {}) } as PublishedEvent
}
function requested(row: Record<string, any>) {
 return { id: row.id, eventId: row.event_id, event: { ...row.event_details, id: row.event_id, revision: row.event_revision, venueIdentity: row.venue_key }, proof: row.proof, createdAt: new Date(row.created_at).toISOString(), ticketId: row.ticket_id ?? null, status: row.ticket_status ?? 'requested' }
}
function offsetOf(value: unknown): number {
 const offset = value === undefined ? 0 : Number(value)
 if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new ApiError(400, 'Invalid page.')
 return offset
}
export function marketplaceRoutes(app: Express, pool: Pool, now: () => number) {
 app.get('/api/marketplace/events', async (req, res) => {
  const offset = offsetOf(req.query.offset)
  const result = await pool.query(`SELECT *, ${currentEvent} AS requests_open FROM event_publications WHERE published ORDER BY requests_open DESC, details->>'date', details->>'time', event_id LIMIT 25 OFFSET $2`, [now(), offset])
  res.json({ events: result.rows.slice(0, 24).map(published), nextOffset: result.rows.length > 24 ? offset + 24 : null })
 })
 app.get(['/api/marketplace/events/:id', '/api/marketplace/events/:id/cover'], async (req, res) => {
  if (!validUUID(req.params.id)) throw new ApiError(404, 'Event not found.')
  const row = (await pool.query(`SELECT *, ${currentEvent} AS requests_open FROM event_publications WHERE event_id=$2 AND published`, [now(), req.params.id])).rows[0]
  if (!row) throw new ApiError(404, 'This event is not published.')
  if (req.path.endsWith('/cover')) {
   const image = row.details.image
   if (!image) throw new ApiError(404, 'Image not found.')
   res.type(image.type).send(Buffer.from(image.data, 'base64')); return
  }
  // Event details stay reachable after their date; new requests are refused below.
  res.json(published(row))
 })
 app.get('/api/events/:id/publication', async (req, res) => {
  if (!validUUID(req.params.id)) throw new ApiError(404, 'Event not found.')
  const row = (await pool.query('SELECT p.* FROM organiser_events e LEFT JOIN event_publications p ON p.event_id=e.id WHERE e.id=$1 AND e.owner_key=$2', [req.params.id, res.locals.owner])).rows[0]
  if (!row) throw new ApiError(404, 'Event not found.')
  res.json({ published: Boolean(row.published), revision: row.revision ?? null })
 })
 app.post('/api/events/:id/publication', async (req, res) => {
  if (!validUUID(req.params.id) || typeof req.body.published !== 'boolean' || !Number.isSafeInteger(req.body.revision)) throw new ApiError(400, 'Invalid publication review.')
  const db = await pool.connect()
  try {
   await db.query('BEGIN')
   const event = (await db.query('SELECT * FROM organiser_events WHERE id=$1 AND owner_key=$2 FOR UPDATE', [req.params.id, res.locals.owner])).rows[0]
   if (!event) throw new ApiError(404, 'Event not found.')
   if (event.revision !== req.body.revision) throw new ApiError(409, 'The event changed. Reload and review before publishing.')
   await db.query('INSERT INTO event_publications(event_id,owner_key,revision,details,published) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(event_id) DO UPDATE SET revision=EXCLUDED.revision,details=EXCLUDED.details,published=EXCLUDED.published,published_at=now()', [event.id, res.locals.owner, event.revision, event.details, req.body.published])
   await db.query('COMMIT'); res.json({ published: req.body.published, revision: event.revision })
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
 })
 app.get('/api/events/:id/requests', async (req, res) => {
  if (!validUUID(req.params.id) || !(await pool.query('SELECT id FROM organiser_events WHERE id=$1 AND owner_key=$2', [req.params.id, res.locals.owner])).rowCount) throw new ApiError(404, 'Event not found.')
  const offset = offsetOf(req.query.offset)
  const rows = (await pool.query('SELECT r.*, i.id AS ticket_id, i.status AS ticket_status FROM attendee_requests r LEFT JOIN venue_issuances i ON i.attendee_request_id=r.id WHERE r.event_id=$1 AND r.venue_key=$2 ORDER BY r.created_at DESC,r.id LIMIT 26 OFFSET $3', [req.params.id, res.locals.owner, offset])).rows
  res.json({ requests: rows.slice(0, 25).map(requested), nextOffset: rows.length > 25 ? offset + 25 : null })
 })
 app.get('/api/tickets/requests', async (req, res) => {
  const offset = offsetOf(req.query.offset)
  if (req.query.eventId !== undefined && !validUUID(req.query.eventId)) throw new ApiError(400, 'Invalid event.')
  const rows = (await pool.query('SELECT r.*, i.id AS ticket_id, i.status AS ticket_status FROM attendee_requests r LEFT JOIN venue_issuances i ON i.attendee_request_id=r.id WHERE r.attendee_key=$1 AND ($3::uuid IS NULL OR r.event_id=$3) ORDER BY r.created_at DESC,r.id LIMIT 26 OFFSET $2', [res.locals.owner, offset, req.query.eventId ?? null])).rows
  res.json({ requests: rows.slice(0, 25).map(requested), nextOffset: rows.length > 25 ? offset + 25 : null })
 })
 app.post('/api/tickets/requests', async (req, res) => {
  let proof
  try { proof = verifyRequestProof(req.body.proof, { eventId: req.body.proof.eventId, revision: req.body.proof.revision, venue: req.body.proof.venue, attendee: res.locals.owner, origin: res.locals.origin }) }
  catch { throw new ApiError(400, 'The receiving-key signature does not match this account, event and website.') }
  const db = await pool.connect()
  try {
   await db.query('BEGIN')
   // Serialize publication changes and all requests for this event.
   const publication = (await db.query('SELECT * FROM event_publications WHERE event_id=$1 FOR UPDATE', [proof.eventId])).rows[0]
   const existing = (await db.query('SELECT * FROM attendee_requests WHERE event_id=$1 AND attendee_key=$2', [proof.eventId, res.locals.owner])).rows[0]
   if (existing) {
    await db.query('COMMIT'); res.json(requested(existing)); return
   }
   if (!publication?.published || publication.owner_key !== proof.venue || publication.revision !== proof.revision) throw new ApiError(409, 'This event publication changed. Reload the event before requesting.')
   const eligible = await db.query(`SELECT event_id FROM event_publications WHERE event_id=$2 AND ${currentEvent}`, [now(), proof.eventId])
   if (!eligible.rowCount) throw new ApiError(409, 'This event date has passed. New requests are closed.')
   const { image: _image, ...details } = publication.details
   const inserted = await db.query('INSERT INTO attendee_requests(id,event_id,attendee_key,venue_key,event_revision,event_details,proof) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *', [proof.request.requestId, proof.eventId, res.locals.owner, proof.venue, proof.revision, details, proof])
   if (!inserted.rowCount) throw new ApiError(409, 'This receiving request is already in use.')
   await db.query('COMMIT'); res.status(201).json(requested(inserted.rows[0]))
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
 })
 app.get('/api/tickets', async (req, res) => {
  const offset = offsetOf(req.query.offset)
  const rows = (await pool.query("SELECT i.id,i.event_id,i.owner_key,i.event_revision,i.event_details,i.request,i.status,i.txid,i.created_at,i.updated_at FROM venue_issuances i JOIN attendee_requests r ON r.id=i.attendee_request_id WHERE r.attendee_key=$1 AND i.status='complete' ORDER BY i.created_at DESC,i.id LIMIT 26 OFFSET $2", [res.locals.owner, offset])).rows
  res.json({ tickets: rows.slice(0, 25).map(row => { const { pkg: _pkg, ...summary } = issuanceRecord(row); return summary }), nextOffset: rows.length > 25 ? offset + 25 : null })
 })
 app.get('/api/tickets/:id', async (req, res) => {
  if (!validUUID(req.params.id)) throw new ApiError(404, 'Ticket not found.')
  const row = (await pool.query("SELECT i.*, r.proof AS attendee_proof FROM venue_issuances i JOIN attendee_requests r ON r.id=i.attendee_request_id WHERE i.id=$1 AND r.attendee_key=$2 AND i.status='complete'", [req.params.id, res.locals.owner])).rows[0]
  if (!row) throw new ApiError(404, 'Ticket not found.')
  res.json(issuanceRecord(row))
 })
}
