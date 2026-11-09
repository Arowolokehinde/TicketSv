import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { AuthFetch, PrivateKey, ProtoWallet, Transaction, MerklePath, Utils } from '@bsv/sdk'
import type { WalletInterface } from '@bsv/sdk'
import type { Server } from 'node:http'
import { syntheticSigningWallet } from './helpers/synthetic-signing-wallet.ts'
import { issueVenueTicket, prepareVenueRecipient } from '../src/wallet/venue-issuance.ts'
import { createApp } from '../server/app.ts'
import { migrate } from '../server/database.ts'

describe.skipIf(!process.env.TEST_DATABASE_URL)('signed authentication and PostgreSQL events', () => {
  let pool: Pool, server: Server, origin: string
  let now = Date.now()
  const signer = new ProtoWallet(PrivateKey.fromRandom())
  const event = { name: 'Harbour Nights', description: '', date: '2027-01-01', time: '18:00', timezone: 'Africa/Lagos', venue: 'The hall', address: '1 Test Street', image: null }
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    await migrate(pool)
    const app = createApp({ pool, wallet: new ProtoWallet(PrivateKey.fromRandom()) as WalletInterface, origins: () => [origin], now: () => now })
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); await pool?.end() })
  function client(wallet = signer) {
    const cookies = new Map<string, string>()
    const transport: typeof fetch = async (input, init) => {
      const response = await fetch(input, { ...init, headers: { 'x-ticketsv-identity': (await wallet.getPublicKey({ identityKey: true })).publicKey, ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })
      for (const item of response.headers.getSetCookie()) { const [key, value] = item.split(';')[0].split('='); cookies.set(key, value) }
      return response
    }
    const auth = new AuthFetch(wallet as WalletInterface, undefined, undefined, undefined, {}, transport)
    const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => transport(origin + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
    const login = async () => {
      const challenge = await (await request('/api/auth/challenge', {})).json()
      const result = await auth.fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(challenge) })
      return { result, challenge, auth }
    }
    return { request, login, cookies }
  }
  it('requires a real BRC signed login, persists session and rejects nonce replay', async () => {
    const c = client()
    expect((await c.request('/api/events')).status).toBe(401)
    const unsigned = await (await c.request('/api/auth/challenge', {})).json()
    expect((await c.request('/api/auth/login', unsigned)).status).toBe(401)
    const { result, challenge, auth } = await c.login()
    expect(result.status).toBe(200)
    const session = await (await c.request('/api/auth/session')).json()
    expect(session.identityKey).toBe((await signer.getPublicKey({ identityKey: true })).publicKey)
    expect(c.cookies.get('ticketsv_session')).toMatch(/^[a-f0-9]{64}$/)
    const replay = await auth.fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(challenge) })
    expect(replay.status).toBe(401)
  })
  it('isolates organiser records, validates input and rejects stale edits', async () => {
    const a = client(), b = client(new ProtoWallet(PrivateKey.fromRandom()))
    await a.login(); await b.login()
    const mismatched = await fetch(origin + '/api/events', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-ticketsv-identity': 'different-account', cookie: [...a.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, body: JSON.stringify({ ...event, requestId: randomUUID() }) })
    expect(mismatched.status).toBe(409)
    const wrongReader = await fetch(origin + '/api/tickets', { headers: { origin, 'x-ticketsv-identity': 'different-account', cookie: [...a.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } })
    expect(wrongReader.status).toBe(409)
    const created = await (await a.request('/api/events', { ...event, requestId: randomUUID(), owner: 'forged' })).json()
    expect(created.name).toBe(event.name)
    expect((await (await b.request('/api/events')).json()).events).toEqual([])
    expect((await b.request(`/api/events/${created.id}`, { ...event, revision: 1 }, 'PUT')).status).toBe(404)
    expect((await a.request(`/api/events/${created.id}`, { ...event, name: 'Updated', revision: 1 }, 'PUT')).status).toBe(200)
    expect((await a.request(`/api/events/${created.id}`, { ...event, revision: 1 }, 'PUT')).status).toBe(409)
    expect((await a.request('/api/events', { ...event, date: '2027-02-30' })).status).toBe(400)
    expect((await a.request('/api/events', { ...event, image: { type: 'image/svg+xml', data: 'PHN2Zz4=' } })).status).toBe(400)
  })
  it('revokes only the cancelled attempt after login has committed', async () => {
    const c = client()
    const first = await c.login()
    const old = c.cookies.get('ticketsv_session')!
    const second = await c.login()
    expect((await c.request('/api/auth/cancel', { cancellationToken: first.challenge.cancellationToken })).status).toBe(200)
    expect((await c.request('/api/auth/session')).status).toBe(200)
    expect((await c.request('/api/auth/cancel', { cancellationToken: second.challenge.cancellationToken })).status).toBe(200)
    expect((await c.request('/api/auth/session')).status).toBe(401)
    c.cookies.set('ticketsv_session', old)
    expect((await c.request('/api/auth/session')).status).toBe(401)
    const pending = await (await c.request('/api/auth/challenge', {})).json()
    await c.request('/api/auth/cancel', { cancellationToken: pending.cancellationToken })
    const auth = second.auth
    expect((await auth.fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending) })).status).toBe(401)
  })
  it('deduplicates event creation and bounds lists without embedded images', async () => {
    const c = client(new ProtoWallet(PrivateKey.fromRandom()))
    await c.login()
    const input = { ...event, requestId: randomUUID() }
    const results = await Promise.all([c.request('/api/events', input), c.request('/api/events', input)])
    const records = await Promise.all(results.map(result => result.json()))
    expect(records[0].id).toBe(records[1].id)
    expect((await c.request('/api/events', { ...input, name: 'Different' })).status).toBe(409)
    const image = { type: 'image/png', data: 'iVBORw0KGgo=' }
    const pictured = await (await c.request('/api/events', { ...event, requestId: randomUUID(), image })).json()
    const listing = await (await c.request('/api/events')).json()
    expect(listing.events).toHaveLength(2)
    expect(listing.events.every((item: { image: unknown }) => item.image === null)).toBe(true)
    expect((await c.request(`/api/events/${pictured.id}/cover`)).headers.get('content-type')).toBe('image/png')
    const other = client(new ProtoWallet(PrivateKey.fromRandom())); await other.login()
    expect((await other.request(`/api/events/${pictured.id}`)).status).toBe(404)
    expect((await other.request(`/api/events/${pictured.id}/cover`)).status).toBe(404)
    expect((await c.request('/api/events?offset=-1')).status).toBe(400)
    for (let index = 0; index < 25; index++) await c.request('/api/events', { ...event, requestId: randomUUID() })
    const firstPage = await (await c.request('/api/events')).json()
    expect(firstPage.events).toHaveLength(25)
    expect(firstPage.nextOffset).toBe(25)
    const secondPage = await (await c.request('/api/events?offset=25')).json()
    expect(secondPage.events).toHaveLength(2)
    expect(secondPage.nextOffset).toBe(null)

  })
  it('rejects foreign origins, expires challenges and revokes sessions on logout', async () => {
    expect((await fetch(origin + '/api/auth/challenge', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })).status).toBe(403)
    const c = client()
    const challenge = await (await c.request('/api/auth/challenge', {})).json()
    now += 6 * 60_000
    const auth = new AuthFetch(signer as WalletInterface, undefined, undefined, undefined, {}, async (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin, cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } }))
    expect((await auth.fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(challenge) })).status).toBe(401)
    await c.login()
    const old = c.cookies.get('ticketsv_session')!
    expect((await c.request('/api/auth/logout', {})).status).toBe(200)
    c.cookies.set('ticketsv_session', old)
    expect((await c.request('/api/events')).status).toBe(401)
    await c.login(); now += 9 * 60 * 60_000
    expect((await c.request('/api/events')).status).toBe(401)
  })
  it('persists owner-scoped issuance reviews and allows only one execution claim', async () => {
    const a = client(new ProtoWallet(PrivateKey.fromRandom())), b = client(new ProtoWallet(PrivateKey.fromRandom()))
    await a.login(); await b.login()
    const eventRecord = await (await a.request('/api/events', { ...event, requestId: randomUUID() })).json()
    const path = `/api/events/${eventRecord.id}/issuances`
    const key = (await signer.getPublicKey({ identityKey: true })).publicKey
    const ticketId = randomUUID(), requestId = `${ticketId}-source`
    const request = { kind: 'ticket-request', version: 1, network: 'testnet', requestId, recipient: { publicKey: key, protocolID: [2, 'counterfoil ticket receiving'], keyID: requestId, counterparty: 'self' } }
    const input = { ticketId, eventRevision: 1, request }
    expect((await b.request(path, input)).status).toBe(404)
    expect((await a.request(path, { ...input, eventRevision: 99 })).status).toBe(409)
    const review = await (await a.request(path, input)).json()
    expect(review.status).toBe('prepared')
    expect(review.event.name).toBe(event.name)
    expect((await (await a.request(path, input)).json()).id).toBe(review.id)
    expect((await (await a.request(`${path}/${review.id}`)).json()).id).toBe(review.id)
    expect((await b.request(`${path}/${review.id}`)).status).toBe(404)
    const secondId = randomUUID(), secondRequestId = `${secondId}-source`
    expect((await a.request(path, { ...input, ticketId: secondId, request: { ...request, requestId: secondRequestId, recipient: { ...request.recipient, keyID: secondRequestId } } })).status).toBe(409)
    expect((await b.request(`${path}/${review.id}/start`, {})).status).toBe(404)
    const starts = await Promise.all([a.request(`${path}/${review.id}/start`, {}), a.request(`${path}/${review.id}/start`, {})])
    expect(starts.map(r => r.status).sort()).toEqual([200, 409])
    expect((await a.request(`${path}/${review.id}/evidence`, { pkg: {} })).status).toBe(400)
    const reloaded = await (await a.request(path)).json()
    expect(reloaded.issuances[0].status).toBe('pending')
    expect((await a.request(`${path}/${review.id}/reference`, { txid: 'a'.repeat(64) })).status).toBe(200)
    expect((await a.request(`${path}/${review.id}/reference`, { txid: 'b'.repeat(64) })).status).toBe(409)
  })

  it('saves authentic issuance evidence and permits idempotent evidence recovery without another execution', async () => {
    const c = client(new ProtoWallet(new PrivateKey(1)))
    await c.login()
    const wallet = syntheticSigningWallet(), owner = (await wallet.getPublicKey({ identityKey: true })).publicKey
    const eventRecord = await (await c.request('/api/events', { ...event, requestId: randomUUID() })).json()
    const ticketId = randomUUID(), request = await prepareVenueRecipient(wallet, owner, ticketId)
    const base = `/api/events/${eventRecord.id}/issuances`, path = `${base}/${ticketId}`
    expect((await c.request(base, { ticketId, eventRevision: 1, request })).status).toBe(201)
    expect((await c.request(path + '/start', {})).status).toBe(200)
    const pkg = await issueVenueTicket(wallet, owner, eventRecord.id, ticketId, request, async txid => {
      expect((await c.request(path + '/reference', { txid })).status).toBe(200)
    })
    expect((await c.request(path + '/evidence', { pkg: { ...pkg, issuance: { ...pkg.issuance, eventId: randomUUID() } } })).status).toBe(400)
    const mined = Transaction.fromAtomicBEEF(Utils.toArray(pkg.atomicBeefBase64, 'base64'))
    mined.merklePath = new MerklePath(1, [[{ offset: 0, hash: mined.id('hex'), txid: true }]])
    expect((await c.request(path + '/evidence', { pkg: { ...pkg, atomicBeefBase64: Utils.toBase64(mined.toAtomicBEEF()) } })).status).toBe(400)
    const saved = await c.request(path + '/evidence', { pkg })
    expect(saved.status).toBe(200)
    expect((await saved.json()).status).toBe('complete')
    expect((await c.request(path + '/evidence', { pkg })).status).toBe(200)
    expect((await c.request(path + '/start', {})).status).toBe(409)
    await c.request(`/api/events/${eventRecord.id}`, { ...event, name: 'Edited later', revision: 1 }, 'PUT')
    const records = await (await c.request(base)).json()
    expect(records.issuances[0].event.name).toBe(event.name)
    expect(records.issuances[0].pkg.current.txid).toBe(pkg.current.txid)
  })

  it('publishes snapshots, keeps drafts private and delivers only to the signed requesting attendee', async () => {
    const wallet = syntheticSigningWallet(), venue = (await wallet.getPublicKey({ identityKey: true })).publicKey
    const buyerWallet = new ProtoWallet(new PrivateKey(73)) as WalletInterface
    buyerWallet.getNetwork = async () => ({ network: 'testnet' })
    const buyer = (await buyerWallet.getPublicKey({ identityKey: true })).publicKey
    const organiser = client(new ProtoWallet(new PrivateKey(1))), attendee = client(buyerWallet as ProtoWallet), stranger = client(new ProtoWallet(new PrivateKey(74)))
    await organiser.login(); await attendee.login(); await stranger.login()
    const ev = await (await organiser.request('/api/events', { ...event, requestId: randomUUID() })).json()
    expect((await fetch(origin + `/api/marketplace/events/${ev.id}`)).status).toBe(404)
    expect((await stranger.request(`/api/events/${ev.id}/publication`, { published: true, revision: 1 })).status).toBe(404)
    expect((await organiser.request(`/api/events/${ev.id}/publication`, { published: true, revision: 1 })).status).toBe(200)
    const pub = await (await fetch(origin + `/api/marketplace/events/${ev.id}`)).json()
    expect(pub.name).toBe(event.name); expect(pub.venueIdentity).toBe(venue)
    expect(pub.owner_key).toBeUndefined()
    expect((await (await fetch(origin + '/api/marketplace/events')).json()).events.some((e: { id: string }) => e.id === ev.id)).toBe(true)
    expect((await fetch(origin + '/api/marketplace/events?offset=-1')).status).toBe(400)
    const past = await (await organiser.request('/api/events', { ...event, date: '2000-01-01', requestId: randomUUID() })).json()
    await organiser.request(`/api/events/${past.id}/publication`, { published: true, revision: 1 })
    expect((await (await fetch(origin + '/api/marketplace/events')).json()).events.some((e: { id: string }) => e.id === past.id)).toBe(true)
    await organiser.request(`/api/events/${ev.id}`, { ...event, name: 'Private edit', revision: 1 }, 'PUT')
    expect((await (await fetch(origin + `/api/marketplace/events/${ev.id}`)).json()).name).toBe(event.name)
    expect((await organiser.request(`/api/events/${ev.id}/publication`, { published: true, revision: 1 })).status).toBe(409)
    const { prepareAttendeeRequest } = await import('../src/wallet/attendee-request.ts')
    const { issueAttendeeTicket } = await import('../src/wallet/venue-issuance.ts')
    const proof = await prepareAttendeeRequest(buyerWallet, { eventId: ev.id, revision: 1, venue, attendee: buyer, origin }, randomUUID())
    expect((await stranger.request('/api/tickets/requests', { proof })).status).toBe(400)
    const pastProof = await prepareAttendeeRequest(buyerWallet, { eventId: past.id, revision: 1, venue, attendee: buyer, origin }, randomUUID())
    expect((await attendee.request('/api/tickets/requests', { proof: pastProof })).status).toBe(409)
    const changedRevision = await prepareAttendeeRequest(buyerWallet, { eventId: ev.id, revision: 99, venue, attendee: buyer, origin }, randomUUID())
    expect((await attendee.request('/api/tickets/requests', { proof: changedRevision })).status).toBe(409)
    expect((await attendee.request('/api/tickets/requests', { proof: { ...proof, signature: 'AAAA' } })).status).toBe(400)
    const response = await attendee.request('/api/tickets/requests', { proof })
    expect(response.status).toBe(201)
    const requested = await response.json()
    expect((await (await attendee.request('/api/tickets/requests', { proof })).json()).id).toBe(requested.id)
    expect((await (await stranger.request('/api/tickets/requests')).json()).requests).toEqual([])
    expect((await (await organiser.request(`/api/events/${ev.id}/requests`)).json()).requests[0].id).toBe(requested.id)
    await organiser.request(`/api/events/${ev.id}/publication`, { published: false, revision: 2 })
    expect((await fetch(origin + `/api/marketplace/events/${ev.id}`)).status).toBe(404)
    const ticketId = randomUUID(), base = `/api/events/${ev.id}/issuances`, path = `${base}/${ticketId}`
    const review = await organiser.request(base, { ticketId, attendeeRequestId: requested.id })
    expect(review.status).toBe(201)
    const reviewed = await review.json()
    expect(reviewed.event.name).toBe(event.name); expect(reviewed.request).toEqual(proof.request)
    expect((await organiser.request(base, { ticketId: randomUUID(), attendeeRequestId: requested.id })).status).toBe(409)
    const starts = await Promise.all([organiser.request(path + '/start', {}), organiser.request(path + '/start', {})])
    expect(starts.map(x => x.status).sort()).toEqual([200, 409])
    const pkg = await issueAttendeeTicket(wallet, venue, ev.id, ticketId, proof, async txid => {
      expect((await organiser.request(path + '/reference', { txid })).status).toBe(200)
    })
    expect((await organiser.request(path + '/evidence', { pkg })).status).toBe(200)
    expect((await organiser.request(path + '/evidence', { pkg })).status).toBe(200)
    const listing = await (await attendee.request('/api/tickets')).json()
    expect(listing.tickets).toHaveLength(1); expect(listing.tickets[0].pkg).toBeUndefined()
    const delivered = await (await attendee.request(`/api/tickets/${ticketId}`)).json()
    expect(delivered.pkg.current.txid).toBe(pkg.current.txid)
    expect(delivered.request).toEqual(proof.request); expect(delivered.owner).toBe(venue)
    expect((await stranger.request(`/api/tickets/${ticketId}`)).status).toBe(404)
    expect((await (await stranger.request('/api/tickets')).json()).tickets).toEqual([])
  })

  it('queues bounded shared preparation only for authenticated accounts and protects collection', async () => {
    const c=client()
    expect((await c.request('/api/tickets/header-preparation',{height:1762324})).status).toBe(401)
    await c.login()
    expect((await c.request('/api/tickets/header-preparation',{height:1762324})).status).toBe(202)
    expect((await c.request('/api/tickets/header-preparation',{height:1766421})).status).toBe(400)
    const status=await (await c.request('/api/headers/status')).json()
    expect(status.network).toBe('testnet')
    expect(status.checkpoint.height).toBe(1762324)
    expect((await c.request('/api/headers/range?start=1762324&count=513')).status).toBe(400)
    expect((await c.request('/api/internal/headers/collect')).status).toBe(401)
  })

})
