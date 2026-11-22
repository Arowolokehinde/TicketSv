import { describe, expect, it, vi } from 'vitest'
import { createNetworkRecorder, measured, networkFor } from '../src/network/recorder.ts'

const origin = 'https://ticketsv.example'
function memory() {
 const items = new Map<string, string>()
 return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v) }, removeItem: (k: string) => { items.delete(k) } }
}
function setup(o: { status?: number; fail?: unknown; online?: boolean; storage?: ReturnType<typeof memory> | null; observeResources?: boolean } = {}) {
 let time = 1_000
 const response = new Response('', { status: o.status ?? 200 })
 const original = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => { time += 5; if (o.fail) throw o.fail; return response })
 const target = { fetch: original as unknown as typeof fetch }
 const recorder = createNetworkRecorder({ target, origin, storage: o.storage === null ? undefined : o.storage ?? memory(), online: () => o.online ?? true, now: () => time, observeResources: o.observeResources ?? false })
 return { target, recorder, response, original, tick: (ms: number) => { time += ms } }
}

describe('network recorder', () => {
 it('records method, host, path without query, purpose, status and duration', async () => {
  const { target, recorder } = setup()
  await target.fetch('https://api.whatsonchain.com/v1/bsv/test/block/5/header?x=1')
  expect(recorder.read().requests).toEqual([{ at: 1_000, method: 'GET', host: 'api.whatsonchain.com', path: '/v1/bsv/test/block/5/header', purpose: 'WhatsOnChain', outcome: 'ok', status: 200, ms: 5 }])
  expect(JSON.stringify(recorder.read())).not.toContain('x=1')
 })
 it('records Request objects and relative URLs', async () => {
  const { target, recorder } = setup()
  await target.fetch(new Request(`${origin}/api/headers/range?start=1`, { method: 'POST' }))
  await target.fetch('/api/auth/session')
  expect(recorder.read().requests.map(r => [r.method, r.host, r.path, r.purpose])).toEqual([['POST', 'ticketsv.example', '/api/headers/range', 'TicketSV headers'], ['GET', 'ticketsv.example', '/api/auth/session', 'TicketSV sign-in']])
 })
 it('classifies outcomes and destinations', async () => {
  const outcome = async (o: Parameters<typeof setup>[0], url = `${origin}/api/events`) => {
   const { target, recorder } = setup(o); await target.fetch(url).catch(() => {}); return recorder.read().requests[0]
  }
  expect(await outcome({ status: 500 })).toMatchObject({ outcome: 'http-error', status: 500, purpose: 'TicketSV API' })
  expect(await outcome({ fail: TypeError('Failed to fetch'), online: false })).toMatchObject({ outcome: 'offline' })
  expect(await outcome({ fail: TypeError('Failed to fetch') })).toMatchObject({ outcome: 'failed' })
  expect(await outcome({ fail: new DOMException('stopped', 'AbortError') })).toMatchObject({ outcome: 'aborted' })
  expect((await outcome({}, 'https://arcade-v2-testnet-us-1.bsvblockchain.tech/v1/tx')).purpose).toBe('ARC')
  expect((await outcome({}, 'https://arcade-v2-testnet-us-1.bsvblockchain.tech/chaintracks/v2/header/height/1')).purpose).toBe('Chaintracks')
  expect((await outcome({}, 'http://localhost:3321/getNetwork')).purpose).toBe('BSV Desktop wallet')
  expect((await outcome({}, `${origin}/assets/app.js`)).purpose).toBe('TicketSV site')
 })
 it('passes responses and errors through unchanged', async () => {
  const ok = setup()
  expect(await ok.target.fetch(`${origin}/api/events`)).toBe(ok.response)
  const error = TypeError('Failed to fetch'), failing = setup({ fail: error })
  await expect(failing.target.fetch(`${origin}/api/events`)).rejects.toBe(error)
 })
 it('measures only requests inside the window and records the check', async () => {
  const { target, recorder, tick } = setup()
  await target.fetch(`${origin}/api/events`); tick(10)
  const { value, network } = await recorder.measure('Ticket verification', async () => {
   await target.fetch(`${origin}/api/headers/range`); await target.fetch('https://api.whatsonchain.com/x'); return { verdict: 'verified' }
  }, v => v.verdict)
  tick(10); await target.fetch(`${origin}/api/events`)
  expect(value).toEqual({ verdict: 'verified' })
  expect(network).toMatchObject({ label: 'Ticket verification', measured: true, requestCount: 2, verdict: 'verified', otherLoads: null })
  expect(network.requests.map(r => r.purpose)).toEqual(['TicketSV headers', 'WhatsOnChain'])
  expect(recorder.read().checks.at(-1)).toMatchObject({ label: 'Ticket verification', verdict: 'verified', requestCount: 2 })
 })
 it('records a failed check and rethrows', async () => {
  const { recorder } = setup(), error = Error('no headers')
  await expect(recorder.measure('Ticket verification', async () => { throw error })).rejects.toBe(error)
  expect(recorder.read().checks.at(-1)).toMatchObject({ verdict: 'error', requestCount: 0 })
 })
 it('caps the journal at 200 requests and 50 checks and survives reload', async () => {
  const storage = memory(), { target, recorder } = setup({ storage })
  for (let i = 0; i < 205; i++) await target.fetch(`${origin}/api/events`)
  for (let i = 0; i < 55; i++) await recorder.measure(`check ${i}`, async () => {})
  const reloaded = createNetworkRecorder({ target: { fetch: vi.fn() as unknown as typeof fetch }, origin, storage, observeResources: false })
  expect(reloaded.read().requests).toHaveLength(200)
  expect(reloaded.read().checks).toHaveLength(50)
  expect(reloaded.read().checks.at(-1)?.label).toBe('check 54')
 })
 it('keeps working when storage throws', async () => {
  const broken = { getItem: () => { throw Error('denied') }, setItem: () => { throw Error('denied') }, removeItem: () => { throw Error('denied') } }
  const { target, recorder } = setup({ storage: broken as unknown as ReturnType<typeof memory> })
  expect((await target.fetch(`${origin}/api/events`)).status).toBe(200)
  expect(recorder.read().requests).toHaveLength(1)
  recorder.clear(); expect(recorder.read()).toEqual({ requests: [], checks: [] })
 })
 it('reports other loads as unmeasured without PerformanceObserver', async () => {
  const { recorder } = setup({ observeResources: false })
  expect((await recorder.measure('x', async () => {})).network.otherLoads).toBeNull()
 })
 it('notifies subscribers and stops after unsubscribe', async () => {
  const { target, recorder } = setup(), listener = vi.fn(), stop = recorder.subscribe(listener)
  await target.fetch(`${origin}/api/events`); stop(); await target.fetch(`${origin}/api/events`)
  expect(listener).toHaveBeenCalledTimes(1)
 })
 it('measured without install reports not measured and never borrows another window', async () => {
  const report = await measured('Ticket verification', async () => ({ verdict: 'verified' }))
  expect(networkFor(report)).toMatchObject({ measured: false, requestCount: 0, otherLoads: null })
  expect(networkFor({ verdict: 'verified' })).toBeUndefined()
  const nested = await measured('Mining verification', async () => ({ verification: { verdict: 'verified' } }), { key: v => v.verification })
  expect(networkFor(nested.verification)?.label).toBe('Mining verification')
 })
})
