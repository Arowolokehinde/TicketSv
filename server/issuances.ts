import type { Express } from 'express'
import type { Pool } from 'pg'
import { Transaction } from '@bsv/sdk'
import { ApiError } from './events.ts'
import { fromBase64, readReceiveRequest, readTicketPackage } from '../src/tickets/codec.ts'
import { verifyContinuity, verifyIssuer, verifyRecipient } from '../src/verification/authenticity.ts'
import { readSigningEvidenceBytes } from '../src/verification/signing-spv.ts'
import type { VenueIssuance } from '../src/events/issuance-types.ts'
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
export function issuanceRecord(row: Record<string, any>): VenueIssuance {
 return { attendeeRequestId: row.attendee_request_id ?? null, ...(row.attendee_proof ? { attendeeProof: row.attendee_proof } : {}), id: row.id, eventId: row.event_id, owner: row.owner_key, eventRevision: row.event_revision, event: row.event_details, request: row.request, status: row.status, txid: row.txid, pkg: row.package, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }
}
export function issuanceRoutes(app: Express, pool: Pool) {
 const base = '/api/events/:eventId/issuances'
 // Mounted after /api/events session enforcement and before the generic event route.
 app.use(base, async (req, res, next) => {
  if (!uuid(req.params.eventId)) throw new ApiError(404, 'Event not found.')
  const result = await pool.query('SELECT * FROM organiser_events WHERE id=$1 AND owner_key=$2', [req.params.eventId, res.locals.owner])
  if (!result.rowCount) throw new ApiError(404, 'Event not found.')
  res.locals.event = result.rows[0]; next()
 })
 app.get(base, async (_req, res) => {
  const result = await pool.query('SELECT i.*, r.proof AS attendee_proof FROM venue_issuances i LEFT JOIN attendee_requests r ON r.id=i.attendee_request_id WHERE i.event_id=$1 AND i.owner_key=$2 ORDER BY i.created_at DESC LIMIT 100', [res.locals.event.id, res.locals.owner])
  res.json({ issuances: result.rows.map(issuanceRecord) })
 })
 app.post(base, async (req, res) => {
  const { ticketId, attendeeRequestId } = req.body
  let { eventRevision } = req.body
  if (!uuid(ticketId) || (attendeeRequestId !== undefined ? !uuid(attendeeRequestId) : !Number.isSafeInteger(eventRevision))) throw new ApiError(400, 'Invalid ticket review.')
  let request
  if (!attendeeRequestId) {
  try { request = readReceiveRequest(JSON.stringify(req.body.request)) } catch { throw new ApiError(400, 'Invalid receiving request.') }
  if (request.requestId !== `${ticketId}-source`) throw new ApiError(400, 'Receiving request does not match this ticket.')
  }
  const db = await pool.connect()
  try {
   await db.query('BEGIN')
   const { rows: [event] } = await db.query('SELECT * FROM organiser_events WHERE id=$1 AND owner_key=$2 FOR UPDATE', [res.locals.event.id, res.locals.owner])
   if (!event) throw new ApiError(404, 'Event not found.')
   let attendee
   if (attendeeRequestId) {
    attendee = (await db.query('SELECT * FROM attendee_requests WHERE id=$1 AND event_id=$2 AND venue_key=$3 FOR UPDATE', [attendeeRequestId, event.id, res.locals.owner])).rows[0]
    if (!attendee) throw new ApiError(404, 'Attendee request not found.')
    request = readReceiveRequest(JSON.stringify(attendee.proof.request)); eventRevision = attendee.event_revision
   }
   const existing = await db.query('SELECT * FROM venue_issuances WHERE id=$1', [ticketId])
   if (existing.rowCount) {
    const row = existing.rows[0]
    if ((row.attendee_request_id ?? undefined) !== attendeeRequestId || row.owner_key !== res.locals.owner || row.event_id !== event.id || row.event_revision !== eventRevision || JSON.stringify(readReceiveRequest(JSON.stringify(row.request))) !== JSON.stringify(request)) throw new ApiError(409, 'Ticket review already exists with different details.')
    await db.query('COMMIT'); res.json(issuanceRecord({ ...row, attendee_proof: attendee?.proof })); return
   }
   if (!attendee && event.revision !== eventRevision) throw new ApiError(409, 'This event changed. Reload before reviewing a ticket.')
   if ((await db.query("SELECT id FROM venue_issuances WHERE event_id=$1 AND status <> 'complete'", [event.id])).rowCount) throw new ApiError(409, 'An unresolved ticket attempt already exists. Reload and review it before issuing another.')
   if (attendee && (await db.query('SELECT id FROM venue_issuances WHERE attendee_request_id=$1', [attendee.id])).rowCount) throw new ApiError(409, 'This request already has a ticket attempt. Review that attempt; do not issue again.')
   const { image: _image, ...details } = attendee?.event_details ?? event.details
   const result = await db.query('INSERT INTO venue_issuances(id,event_id,owner_key,event_revision,event_details,request,attendee_request_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [ticketId, event.id, res.locals.owner, eventRevision, details, request, attendee?.id ?? null])
   await db.query('COMMIT'); res.status(201).json(issuanceRecord({ ...result.rows[0], attendee_proof: attendee?.proof }))
  } catch (error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
 })
 app.use(`${base}/:ticketId`, async (req, res, next) => {
  if (!uuid(req.params.ticketId)) throw new ApiError(404, 'Ticket attempt not found.')
  const result = await pool.query('SELECT i.*, r.proof AS attendee_proof FROM venue_issuances i LEFT JOIN attendee_requests r ON r.id=i.attendee_request_id WHERE i.id=$1 AND i.event_id=$2 AND i.owner_key=$3', [req.params.ticketId, res.locals.event.id, res.locals.owner])
  if (!result.rowCount) throw new ApiError(404, 'Ticket attempt not found.')
  res.locals.issuance = result.rows[0]; next()
 })
 app.get(`${base}/:ticketId`, (_req, res) => res.json(issuanceRecord(res.locals.issuance)))
 app.post(`${base}/:ticketId/start`, async (_req, res) => {
  const result = await pool.query("UPDATE venue_issuances SET status='pending', updated_at=now() WHERE id=$1 AND owner_key=$2 AND status='prepared' RETURNING *", [res.locals.issuance.id, res.locals.owner])
  if (!result.rowCount) throw new ApiError(409, 'This attempt has already started. Do not repeat issuance; review the saved record.')
  res.json(issuanceRecord({ ...result.rows[0], attendee_proof: res.locals.issuance.attendee_proof }))
 })
 app.post(`${base}/:ticketId/reference`, async (req, res) => {
  const txid = req.body.txid
  if (typeof txid !== 'string' || !/^[a-f0-9]{64}$/.test(txid)) throw new ApiError(400, 'Invalid transaction ID.')
  const result = await pool.query("UPDATE venue_issuances SET txid=$1, updated_at=now() WHERE id=$2 AND owner_key=$3 AND status='pending' AND (txid IS NULL OR txid=$1) RETURNING *", [txid, res.locals.issuance.id, res.locals.owner])
  if (!result.rowCount) throw new ApiError(409, 'The transaction reference cannot be replaced.')
  res.json(issuanceRecord({ ...result.rows[0], attendee_proof: res.locals.issuance.attendee_proof }))
 })
 app.post(`${base}/:ticketId/evidence`, async (req, res) => {
  const saved = res.locals.issuance
  let pkg
  try {
   pkg = readTicketPackage(JSON.stringify(req.body.pkg))
   if (saved.status === 'prepared' || pkg.issuance.eventId !== saved.event_id || pkg.issuance.ticketId !== saved.id || pkg.lineageRawTxs.length !== 1 || pkg.current.txid !== saved.txid) throw Error('Wrong issuance')
   verifyIssuer(pkg, saved.owner_key); verifyContinuity(pkg); verifyRecipient(pkg, saved.request)
   const evidence = readSigningEvidenceBytes(pkg.current.txid, fromBase64(pkg.atomicBeefBase64))
   const transaction = Transaction.fromAtomicBEEF([...evidence.atomicBeef])
   if (transaction.toHex() !== pkg.lineageRawTxs[0]) throw Error('Transaction mismatch')
   if (!saved.package && transaction.merklePath) throw Error('First issuance must be checked before accepting a mining update')
   if (!await transaction.verify('scripts only')) throw Error('Transaction scripts failed')
   if (saved.package) {
    if (saved.package.lineageRawTxs[0] !== pkg.lineageRawTxs[0] || saved.package.issuance.signedBytesBase64 !== pkg.issuance.signedBytesBase64 || saved.package.issuance.signatureBase64 !== pkg.issuance.signatureBase64) throw Error('Changed issuance')
    const previous = Transaction.fromAtomicBEEF(fromBase64(saved.package.atomicBeefBase64))
    if (previous.merklePath && !Transaction.fromAtomicBEEF([...evidence.atomicBeef]).merklePath) throw Error('Mining proof removed')
   }
  } catch { throw new ApiError(400, 'Evidence does not match the reviewed ticket, recipient and venue signature.') }
  // Evidence is saved, not declared mined. Header verification stays local.
  const result = await pool.query("UPDATE venue_issuances SET package=$1, status='complete', updated_at=now() WHERE id=$2 AND owner_key=$3 AND status IN ('pending','complete') AND txid=$4 AND package IS NOT DISTINCT FROM $5::jsonb RETURNING *", [pkg, saved.id, res.locals.owner, pkg.current.txid, saved.package])
  if (!result.rowCount) throw new ApiError(409, 'Ticket attempt changed; reload its record.')
  res.json(issuanceRecord({ ...result.rows[0], attendee_proof: res.locals.issuance.attendee_proof }))
 })
}
