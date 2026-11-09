import { beforeEach, expect, it, vi } from 'vitest'
import { Utils } from '@bsv/sdk'
import { ticketFixture } from './helpers/ticket-fixture.ts'
import a from './fixtures/headers/woc-1762324.json' with { type: 'json' }
import b from './fixtures/headers/woc-1762325.json' with { type: 'json' }
import { makeSnapshot, parseProviderHeader, type HeaderSnapshot } from '../src/headers/validate.ts'
import { verifyVenueTicket } from '../src/events/verify-venue-ticket.ts'

// Replace browser persistence only; parsing, signatures, sync and verification are real.
let stored: HeaderSnapshot | undefined
vi.mock('../src/headers/store.ts', () => ({
 loadSnapshot: async () => stored,
 saveSnapshot: async (snapshot: HeaderSnapshot, signal: AbortSignal, expected: { id?: string }) => {
  signal.throwIfAborted()
  if (stored?.id !== expected.id) throw Error('Headers changed in another tab')
  stored = snapshot
 },
}))
const headers = [parseProviderHeader(a, 'whatsonchain', a.height), parseProviderHeader(b, 'whatsonchain', b.height)]
beforeEach(() => { stored = undefined })
async function fixture() {
 const f = await ticketFixture()
 // Intentionally invented root: downloading valid headers must never turn this into a pass.
 f.issue.inputs[0].sourceTransaction!.merklePath!.blockHeight = b.height
 f.pkg.atomicBeefBase64 = Utils.toBase64(f.transfer.toAtomicBEEF())
 return f
}
function options(f: Awaited<ReturnType<typeof fixture>>, extra = {}) {
 return { trustedVenueIdentity: f.identity, expectedRequest: f.destination, online: true, signal: new AbortController().signal, ...extra }
}
it('fetches and persists missing headers automatically, then rejects a contradictory proof', async () => {
 const f = await fixture(), calls: number[] = []
 const result = await verifyVenueTicket(f.pkg, { ...options(f), getHeader: async (_provider, height) => { calls.push(height); return headers.find(h => h.height === height)! } })
 expect(calls).toEqual([1762324, 1762324, 1762325, 1762325])
 expect(stored?.headers.at(-1)?.height).toBe(1762325)
 expect(result.verdict).toBe('rejected')
 expect(result.checks.find(c => c.name === 'anchors')?.status).toBe('fail')
})
it('offline missing headers remain incomplete without network access', async () => {
 const f = await fixture(), getHeader = vi.fn()
 const result = await verifyVenueTicket(f.pkg, { ...options(f), online: false, getHeader })
 expect(result.verdict).toBe('incomplete'); expect(getHeader).not.toHaveBeenCalled(); expect(stored).toBeUndefined()
})
it('a saved snapshot verifies locally without fetching even while online', async () => {
 const f = await fixture(), getHeader = vi.fn()
 stored = makeSnapshot(headers)
 const result = await verifyVenueTicket(f.pkg, { ...options(f), getHeader })
 expect(result.verdict).toBe('rejected'); expect(getHeader).not.toHaveBeenCalled()
})
it('invalid venue signatures do not trigger header downloads', async () => {
 const f = await fixture(), getHeader = vi.fn()
 f.pkg.issuance.ticketId = 'tampered'
 const result = await verifyVenueTicket(f.pkg, { ...options(f), getHeader })
 expect(result.verdict).toBe('rejected'); expect(getHeader).not.toHaveBeenCalled()
})
it('cancellation retains validated progress and never returns a successful verdict', async () => {
 const f = await fixture(), controller = new AbortController()
 const run = verifyVenueTicket(f.pkg, { ...options(f), signal: controller.signal,
  getHeader: async (_provider, height) => headers.find(h => h.height === height)!,
  onProgress: () => controller.abort(Error('Cancelled')),
 })
 await expect(run).rejects.toThrow('Cancelled')
 expect(stored?.headers.at(-1)?.height).toBe(1762324)
})
it('provider failure retains the saved prefix for a later retry', async () => {
 const f = await fixture()
 await expect(verifyVenueTicket(f.pkg, { ...options(f), getHeader: async (_provider, height) => {
  if (height === b.height) throw Error('Source unavailable')
  return headers[0]
 } })).rejects.toThrow('Source unavailable')
 expect(stored?.headers.at(-1)?.height).toBe(1762324)
})
