import {scannerAuthorizationRoute} from './scanner-authorization.ts'
import express from 'express'
import {receivedTicketRoutes} from './received-tickets.ts'
import { headerRoutes } from './header-routes.ts'
import { marketplaceRoutes } from './marketplace.ts'
import { issuanceRoutes } from './issuances.ts'
import type { ErrorRequestHandler } from 'express'
import type { Pool } from 'pg'
import { createAuthMiddleware, type AuthRequest } from '@bsv/auth-express-middleware'
import { SessionManager, type AsyncSessionManager, type WalletInterface } from '@bsv/sdk'
import { randomUUID } from 'node:crypto'
import { CHALLENGE_MS, SESSION_MS, cookie, hashToken, sessionFor, setCookie, token } from './auth.ts'
import { ApiError, eventInput, eventRecord, updateEvent } from './events.ts'

export function createApp({ pool, wallet, origins, now = Date.now, trustProxy = false, sessionManager, resumeHeaders }: { pool: Pool; wallet: WalletInterface; origins: () => string[]; now?: () => number; trustProxy?: false | string; sessionManager?: AsyncSessionManager; resumeHeaders?:()=>void }) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)
  const limits = new Map<string, { count: number; until: number }>()
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    const origin = origins().find(value => new URL(value).host === req.headers.host)
    if (!origin || (req.headers.origin && req.headers.origin !== origin) || (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin)) { res.status(403).json({ error: 'This request must come from the TicketSV website.' }); return }
    res.locals.origin = origin
    if (req.path !== '/api/auth/session' && req.path !== '/api/auth/cancel' && (req.path.startsWith('/api/auth/') || req.path === '/.well-known/auth')) {
      const time = now(), key = req.ip ?? 'unknown'
      for (const [ip, state] of limits) if (state.until <= time) limits.delete(ip)
      const state = limits.get(key) ?? { count: 0, until: time + 60_000 }
      if (++state.count > 120 || limits.size >= 10_000 && !limits.has(key)) { res.status(429).json({ error: 'Too many login requests. Wait a minute and try again.' }); return }
      limits.set(key, state)
    }
    next()
  })
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) { res.status(415).json({ error: 'Use application/json.' }); return }
    next()
  })
  const ordinaryJSON=express.json({limit:'3mb',strict:true}),archiveJSON=express.json({limit:'4mb',strict:true})
  app.use((req,res,next)=>(req.path==='/api/tickets/received'?archiveJSON:ordinaryJSON)(req,res,next))
  app.post('/api/auth/challenge', async (req, res) => {
    const secret = token(), nonce = token(), cancellationToken = token(), origin = res.locals.origin as string
    await pool.query('DELETE FROM login_challenges WHERE expires_at<=$1 OR token_hash=$2', [now(), hashToken(cookie(req, 'ticketsv_login'))])
    await pool.query('DELETE FROM login_sessions WHERE expires_at<=$1', [now()])
    await pool.query('INSERT INTO login_challenges VALUES ($1,$2,$3,$4,$5)', [hashToken(secret), nonce, hashToken(cancellationToken), origin, now() + CHALLENGE_MS])
    setCookie(res, 'ticketsv_login', secret, origin, CHALLENGE_MS)
    res.json({ nonce, cancellationToken, origin, purpose: 'Sign in to TicketSV', network: 'testnet' })
  })
  const authenticate = createAuthMiddleware({ wallet, allowUnauthenticated: false,
    sessionManager: sessionManager ?? new SessionManager({ maxSessions: 1000, maxSessionIdleMs: CHALLENGE_MS, maxMessageNoncesPerSession: 100, maxInitialRequestNonces: 2000 }),
    transportLimits: { maxPendingRequests: 100, maxRequestBytes: 16_384, maxResponseBytes: 16_384, requestTimeoutMs: 15_000 },
  })
  // Mount at root so BRC-104 authenticates the original path, not a stripped path.
  app.use((req, res, next) => { if (req.path === '/.well-known/auth' || req.path === '/api/auth/login') authenticate(req, res, next); else next() })
  app.post('/api/auth/login', async (req: AuthRequest, res) => {
    const origin = res.locals.origin as string
    if (!req.auth?.identityKey || req.auth.identityKey === 'unknown' || req.body?.origin !== origin || req.body?.purpose !== 'Sign in to TicketSV' || req.body?.network !== 'testnet' || typeof req.body?.nonce !== 'string') throw new ApiError(401, 'Login could not be verified. Please reconnect.')
    const db = await pool.connect()
    const secret = token(), expires = now() + SESSION_MS
    try {
      await db.query('BEGIN')
      const used = await db.query('DELETE FROM login_challenges WHERE token_hash=$1 AND nonce=$2 AND origin=$3 AND expires_at>$4 RETURNING cancellation_hash', [hashToken(cookie(req, 'ticketsv_login')), req.body.nonce, origin, now()])
      if (!used.rowCount) throw new ApiError(401, 'Login expired or already used. Please reconnect.')
      await db.query('DELETE FROM login_sessions WHERE token_hash=$1', [hashToken(cookie(req, 'ticketsv_session'))])
      await db.query('INSERT INTO login_sessions VALUES ($1,$2,$3,$4,$5)', [hashToken(secret), req.auth.identityKey, used.rows[0].cancellation_hash, origin, expires])
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK'); throw error }
    finally { db.release() }
    setCookie(res, 'ticketsv_login', '', origin, 0)
    setCookie(res, 'ticketsv_session', secret, origin, SESSION_MS)
    res.json({ identityKey: req.auth.identityKey, network: 'testnet', expiresAt: new Date(expires).toISOString() })
  })
  // Cancellation is scoped to one attempt. Deleting the challenge serializes
  // with login's transaction, so it also revokes a login that just committed.
  app.post('/api/auth/cancel', async (req, res) => {
    if (!/^[a-f0-9]{64}$/.test(req.body?.cancellationToken ?? '')) throw new ApiError(400, 'Invalid cancellation token.')
    const cancellation = hashToken(req.body.cancellationToken), origin = res.locals.origin
    const db = await pool.connect()
    try {
      await db.query('BEGIN')
      await db.query('DELETE FROM login_challenges WHERE cancellation_hash=$1 AND origin=$2', [cancellation, origin])
      await db.query('DELETE FROM login_sessions WHERE cancellation_hash=$1 AND origin=$2', [cancellation, origin])
      await db.query('COMMIT')
    } catch (error) { await db.query('ROLLBACK'); throw error }
    finally { db.release() }
    // Never clear cookies here: a different tab may have signed in since.
    res.json({ cancelled: true })
  })
  app.get('/api/auth/session', async (req, res) => {
    const session = await sessionFor(pool, req, res.locals.origin, now())
    res.status(session ? 200 : 401).json(session ?? { error: 'Sign in to continue.' })
  })
  app.post('/api/auth/logout', async (req, res) => {
    await pool.query('DELETE FROM login_sessions WHERE token_hash=$1', [hashToken(cookie(req, 'ticketsv_session'))])
    await pool.query('DELETE FROM login_challenges WHERE token_hash=$1', [hashToken(cookie(req, 'ticketsv_login'))])
    setCookie(res, 'ticketsv_session', '', res.locals.origin, 0)
    setCookie(res, 'ticketsv_login', '', res.locals.origin, 0)
    res.json({ signedOut: true })
  })
  scannerAuthorizationRoute(app,pool,wallet,now)
  app.use(['/api/events', '/api/tickets'], async (req, res, next) => {
    const session = await sessionFor(pool, req, res.locals.origin, now())
    if (!session) { res.status(401).json({ error: 'Your session expired. Sign in again.' }); return }
    if ((!['GET', 'HEAD'].includes(req.method) || req.headers['x-ticketsv-identity'] !== undefined) && req.headers['x-ticketsv-identity'] !== session.identityKey) { res.status(409).json({ error: 'The signed-in account changed. Reload your events before saving.' }); return }
    res.locals.owner = session.identityKey
    next()
  })
  app.get('/api/health', async (_req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',network:'testnet'})})
  headerRoutes(app, pool, resumeHeaders)
  receivedTicketRoutes(app, pool)
  marketplaceRoutes(app, pool, now)
  issuanceRoutes(app, pool)
  const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  app.get('/api/events', async (req, res) => {
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset)
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new ApiError(400, 'Invalid event page.')
    const result = await pool.query("SELECT id, revision, created_at, updated_at, details - 'image' AS details, details->'image' <> 'null'::jsonb AS has_image FROM organiser_events WHERE owner_key=$1 ORDER BY created_at DESC, id LIMIT 26 OFFSET $2", [res.locals.owner, offset])
    res.json({ events: result.rows.slice(0, 25).map(row => ({ ...eventRecord(row), image: null, coverUrl: row.has_image ? `/api/events/${row.id}/cover` : undefined })), nextOffset: result.rows.length > 25 ? offset + 25 : null })
  })
  app.get('/api/events/:id{/:asset}', async (req, res) => {
    const id = String(req.params.id), asset = req.params.asset
    if (!validId(id) || asset && asset !== 'cover') throw new ApiError(404, 'Event not found.')
    const result = await pool.query('SELECT * FROM organiser_events WHERE id=$1 AND owner_key=$2', [id, res.locals.owner])
    if (!result.rowCount) throw new ApiError(404, 'Event not found.')
    if (asset) {
      const image = result.rows[0].details.image
      if (!image) throw new ApiError(404, 'Image not found.')
      res.type(image.type).send(Buffer.from(image.data, 'base64'))
    } else res.json(eventRecord(result.rows[0]))
  })
  app.post('/api/events', async (req, res) => {
    const details = eventInput(req.body), requestId = req.body.requestId
    if (typeof requestId !== 'string' || !validId(requestId)) throw new ApiError(400, 'A creation request ID is required.')
    const result = await pool.query('INSERT INTO organiser_events(id,owner_key,request_id,creation_details,details) VALUES ($1,$2,$3,$4,$4) ON CONFLICT (owner_key,request_id) DO NOTHING RETURNING *', [randomUUID(), res.locals.owner, requestId, details])
    if (result.rowCount) { res.status(201).json(eventRecord(result.rows[0])); return }
    const existing = await pool.query('SELECT *, creation_details=$3::jsonb AS matches FROM organiser_events WHERE owner_key=$1 AND request_id=$2', [res.locals.owner, requestId, details])
    if (!existing.rows[0]?.matches) throw new ApiError(409, 'This creation request was already saved with different details. Reload your events before editing it.')
    res.json(eventRecord(existing.rows[0]))
  })
  app.put('/api/events/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!validId(id)) throw new ApiError(404, 'Event not found.')
    res.json(await updateEvent(pool, res.locals.owner, id, req.body?.revision, eventInput(req.body)))
  })
  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }))
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return
    const status = error instanceof ApiError ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500
    res.status(status).json({ error: error instanceof ApiError ? error.message : status === 500 ? 'The server could not complete this request. Please try again.' : 'Invalid or oversized request.' })
  }
  app.use(errors)
  return app
}
