import { test, expect } from '@playwright/test'

test('saved tickets opens without authentication or wallet requests', async ({ page, context }) => {
 const contacts: string[] = []
 await context.route('**/api/**', r => { contacts.push(r.request().url()); return r.abort() })
 await context.route('http://localhost:3321/**', r => { contacts.push(r.request().url()); return r.abort() })
 await page.goto('/offline/tickets')
 await expect(page.getByRole('heading', { name: /^On this device/ })).toBeVisible()
 await expect(page.getByText('No tickets saved on this device.')).toBeVisible()
 expect(contacts).toEqual([])
})

import { build } from 'vite'
import { Utils } from '@bsv/sdk'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { accountApi } from './helpers/account-api.ts'
import { makeSnapshot, parseProviderHeader } from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1762324.json' with { type: 'json' }
import type { Page } from '@playwright/test'
declare global { interface Window { AttendeeOfflineTest: typeof import('./helpers/attendee-offline-browser-entry.tsx') } }
const snapshot = makeSnapshot([parseProviderHeader(a, 'whatsonchain', a.height)])
let bundle: string
// Positive persistence/UI tests use invented mining roots at an explicit test-only
// SPV boundary. Production worker tests below use the real verifier (incomplete
// or rejected for synthetic anchors), never substitute the verifier in dist.
test.beforeAll(async () => {
 const target = resolve('src/verification/signing-spv.ts')
 const built = await build({ configFile: false, publicDir: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.PROD': 'true', 'import.meta.env.VITE_SHARED_HEADERS': '"false"' }, plugins: [{ name: 'synthetic-offline-spv', async load(id) {
  if (id === target) { const source = await readFile(target, 'utf8'); return source.slice(0, source.indexOf('export async function verifySigningEvidence')) + `export async function verifySigningEvidence(evidence,snapshot){if(!snapshot)throw Error('Verification incomplete — required block header missing');return {subjectMined:!!Transaction.fromAtomicBEEF(evidence.atomicBeef).merklePath}}` }
 } }], build: { write: false, minify: false, lib: { entry: resolve('tests/helpers/attendee-offline-browser-entry.tsx'), name: 'AttendeeOfflineTest', formats: ['iife'] } } })
 const output = Array.isArray(built) ? built[0] : built
 if (!('output' in output)) throw Error('Missing test bundle')
 bundle = output.output.filter(x => x.type === 'chunk').map(x => x.code).join('\n')
})
async function seedHeaders(page: Page) {
 await page.evaluate(async snapshot => new Promise<void>((resolve, reject) => {
  const r = indexedDB.open('counterfoil-spv-experiment-v1', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('snapshots')
  r.onsuccess = () => { const db = r.result, tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(snapshot, 'accepted'); tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => reject(tx.error) }
 }), snapshot)
}
async function helpers(page: Page) { await page.addScriptTag({ content: bundle }) }
async function mount(page: Page, path = '/tickets') {
 await page.route(url => url.pathname === path, r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="test-root"></div>' }))
 await page.goto(path); await helpers(page); await seedHeaders(page)
 await page.evaluate(() => window.AttendeeOfflineTest.render())
}
async function prepareApp(page: Page) {
 await page.evaluate(() => window.AttendeeOfflineTest.prepareAttendeeApp(new AbortController().signal))
}

test('Dashboard saves the current mined package and device library survives logout', async ({ page, context }) => {
 const f = await attendeeOfflineFixture(), auth = await accountApi(context)
 auth.setSession({ identityKey: f.identity, network: 'testnet', expiresAt: new Date(Date.now() + 3600000).toISOString() })
 const oldRecord = structuredClone(f.record), miningPath = f.tx.merklePath!.toHex()
 f.tx.merklePath = undefined; oldRecord.pkg!.atomicBeefBase64 = Utils.toBase64(f.tx.toAtomicBEEF())
 await context.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/tx/**', r => r.fulfill({ json: { txid: f.record.txid, txStatus: 'MINED', blockHeight: a.height, blockHash: a.hash, merklePath: miningPath } }))
 let wallets = 0
 await context.route('http://localhost:3321/**', r => { wallets++; return r.abort() })
 await context.route('**/api/tickets', r => r.fulfill({ json: { tickets: [f.record], nextOffset: null } }))
 await context.route('**/api/tickets/requests**', r => r.fulfill({ json: { requests: [], nextOffset: null } }))
 await context.route(`**/api/tickets/${f.record.id}`, r => r.fulfill({ json: oldRecord }))
 await mount(page)
 await page.getByRole('button', { name: 'View ticket', exact: true }).click()
 await page.getByRole('button', { name: 'Save for offline use', exact: true }).click()
 const savePanel = page.getByRole('region', { name: 'Save for offline use', exact: true })
 await expect(savePanel.getByRole('alert')).toContainText('Mining inclusion is not verified')
 expect(await page.evaluate(() => window.AttendeeOfflineTest.listSavedTickets(location.origin))).toHaveLength(0)
 await page.getByRole('button', { name: 'Check mining evidence', exact: true }).click()
 await expect(page.getByRole('status')).toContainText('Mining evidence loaded')
 let releaseCache!: () => void
 const cacheGate = new Promise<void>(resolve => { releaseCache = resolve })
 await context.route('**/assets/wallet-*.js', async r => { await cacheGate; await r.fulfill({ status: 503, body: 'Synthetic app cache failure' }) })
 await page.getByRole('button', { name: 'Save for offline use', exact: true }).click()
 await expect(savePanel.getByRole('status')).toContainText('Saving app files')
 const libraryLink = savePanel.getByRole('link', { name: 'Open saved tickets', exact: true })
 await expect(libraryLink).toHaveAttribute('aria-disabled', 'true')
 // Even a programmatic click must not interrupt preparation.
 await libraryLink.evaluate((link: HTMLAnchorElement) => link.click())
 await expect(page).toHaveURL(/\/tickets$/)
 releaseCache()
 await expect(savePanel.getByRole('alert')).toContainText('App files could not be saved')
 await expect(page.getByText('Ticket: saved on this device', { exact: true })).toBeVisible()
 await expect(page.getByText('Offline app: available', { exact: true })).toHaveCount(0)
 await context.unroute('**/assets/wallet-*.js')
 await page.getByRole('button', { name: 'Save for offline use', exact: true }).click()
 await expect(page.getByText('Offline app: available', { exact: true })).toBeVisible({ timeout: 20000 })
 const rows = await page.evaluate(() => window.AttendeeOfflineTest.listSavedTickets(location.origin))
 expect(rows).toHaveLength(1); expect(rows[0].evidence?.pkg).toEqual(f.record.pkg)
 expect(rows[0].evidence?.attendee).toBe(f.identity); expect(rows[0].evidence?.trustedVenue).toBe(f.record.owner)
 expect(wallets).toBe(0)
 // The API still has the original unmined envelope after a page reload. Reuse
 // the matching device proof, then verify it afresh, without another ARC call.
 await context.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/tx/**', r => r.abort())
 await mount(page)
 await page.getByRole('button', { name: 'View ticket', exact: true }).click()
 await page.getByRole('button', { name: 'Save for offline use', exact: true }).click()
 await expect(page.getByText('Offline app: available', { exact: true })).toBeVisible({ timeout: 10000 })
 auth.setSession(null)
 await page.unrouteAll()
 await page.goto('/offline/tickets')
 await expect(page.getByRole('heading', { name: 'Harbour Nights', exact: true })).toBeVisible()
 await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0)
})

test('IndexedDB keeps multiple tickets, rejects replacements and protects stale removal', async ({ page }) => {
 await page.goto('/offline/tickets'); await helpers(page); await seedHeaders(page)
 const first = await attendeeOfflineFixture(), second = await attendeeOfflineFixture('http://127.0.0.1:4175', true, 3)
 const save = (f: typeof first) => page.evaluate(async f => {
  const api = window.AttendeeOfflineTest
  await api.saveAttendeeTicket(api.attendeeEvidence(f.record, f.identity, location.origin), location.origin, new AbortController().signal, () => {})
 }, { record: f.record, identity: f.identity })
 await save(first); await save(second)
 const rows = await page.evaluate(() => window.AttendeeOfflineTest.listSavedTickets(location.origin))
 expect(rows).toHaveLength(2)
 const corrupt = structuredClone(first); corrupt.record.pkg!.issuance.signatureBase64 = 'AAAA'
 await expect(save(corrupt)).rejects.toThrow(/not fully verified/)
 expect((await page.evaluate(() => window.AttendeeOfflineTest.listSavedTickets(location.origin)))).toEqual(rows)
 const cancelled = await page.evaluate(async f => {
  const api = window.AttendeeOfflineTest, controller = new AbortController(); controller.abort(Error('cancelled'))
  try { await api.saveAttendeeTicket(api.attendeeEvidence(f.record, f.identity, location.origin), location.origin, controller.signal, () => {}); return false } catch { return true }
 }, { record: first.record, identity: first.identity })
 expect(cancelled).toBe(true)
 await save(first)
 const stale = rows.find(row => row.evidence?.id === first.record.id)!
 await expect(page.evaluate(row => window.AttendeeOfflineTest.removeSavedTicket(JSON.parse(row)), JSON.stringify(stale))).rejects.toThrow(/changed in another tab/)
 const current = await page.evaluate(() => window.AttendeeOfflineTest.listSavedTickets(location.origin))
 await page.evaluate(row => window.AttendeeOfflineTest.removeSavedTicket(JSON.parse(row)), JSON.stringify(current.find(row => row.evidence?.id === first.record.id)!))
 expect((await page.evaluate(() => window.AttendeeOfflineTest.listSavedTickets(location.origin)))[0].evidence?.id).toBe(second.record.id)
})

test('real production page and saved evidence reopen offline without auth or wallet traffic', async ({ page, context }) => {
 const f = await attendeeOfflineFixture()
 await page.goto('/offline/tickets'); await helpers(page); await seedHeaders(page)
 await page.evaluate(async f => { const api = window.AttendeeOfflineTest; await api.saveAttendeeTicket(api.attendeeEvidence(f.record, f.identity, location.origin), location.origin, new AbortController().signal, () => {}) }, { record: f.record, identity: f.identity })
 await prepareApp(page)
 // Delete headers deliberately: genuine production verification must fail closed.
 await page.evaluate(async () => new Promise<void>(resolve => { const r = indexedDB.open('counterfoil-spv-experiment-v1'); r.onsuccess = () => { const db = r.result, tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').clear(); tx.oncomplete = () => { db.close(); resolve() } } }))
 await page.reload(); await context.setOffline(true); await page.close()
 const reopened = await context.newPage(), calls: string[] = []
 context.on('request', r => { if (r.url().includes('/api/') || r.url().includes(':3321')) calls.push(r.url()) })
 await reopened.goto('/offline/tickets')
 await reopened.getByRole('button', { name: 'Open ticket', exact: true }).click()
 await reopened.getByRole('button', { name: 'Verify locally', exact: true }).click()
 await expect(reopened.getByRole('heading', { name: 'Saved ticket verification: incomplete' })).toBeVisible()
 await expect(reopened.getByText('recipient: pass — recipient check passed')).toBeVisible()
 expect(calls).toEqual([])
 expect(await reopened.evaluate(async () => { try { await fetch('/api/auth/session'); return false } catch { return true } })).toBe(true)
 await reopened.screenshot({ path: test.info().outputPath('saved-tickets.png'), fullPage: true })
 expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
 await reopened.getByRole('button', { name: 'Remove from this device', exact: true }).click()
 await reopened.getByRole('button', { name: 'Confirm removal', exact: true }).click()
 await expect(reopened.getByText('No tickets saved on this device.')).toBeVisible()
})

test('corrupt device rows can be removed without displaying a verified verdict', async ({ page }) => {
 await page.goto('/offline/tickets')
 await page.evaluate(async () => new Promise<void>(resolve => { const r = indexedDB.open('ticketsv-attendee-offline-v1'); r.onsuccess = () => { const db = r.result, tx = db.transaction('tickets', 'readwrite'); tx.objectStore('tickets').put({ broken: true }, 'broken'); tx.oncomplete = () => { db.close(); resolve() } } }))
 await page.reload(); await expect(page.getByRole('alert')).toContainText('damaged')
 await expect(page.getByRole('button', { name: 'Open ticket', exact: true })).toHaveCount(0)
 await page.getByRole('button', { name: 'Remove from this device', exact: true }).click(); await page.getByRole('button', { name: 'Confirm removal', exact: true }).click()
 await expect(page.getByText('No tickets saved on this device.')).toBeVisible()
})

test('product and experiment worker caches coexist, and an evicted product cache is repaired', async ({ page, context }) => {
 await page.goto('/offline/tickets'); await helpers(page); await prepareApp(page)
 const experiment = await context.newPage(); await experiment.goto('/dev/reopening')
 await experiment.getByRole('button', { name: 'Prepare app for offline reopening', exact: true }).click()
 await expect(experiment.getByRole('status')).toContainText('App files saved')
 const names = await page.evaluate(() => caches.keys())
 expect(names.some(n => n.startsWith('counterfoil-reopening-'))).toBe(true)
 expect(names.some(n => n.startsWith('ticketsv-attendee-app-'))).toBe(true)
 await page.evaluate(async () => { for (const name of await caches.keys()) if (name.startsWith('ticketsv-attendee-app-')) await caches.delete(name) })
 await prepareApp(page)
 expect(await page.evaluate(async () => { const name = (await caches.keys()).find(n => n.startsWith('ticketsv-attendee-app-'))!; return (await (await caches.open(name)).keys()).length })).toBeGreaterThan(1)
 await context.setOffline(true); await page.close(); const next = await context.newPage(); await next.goto('/offline/tickets')
 await expect(next.getByRole('heading', { name: /^On this device/ })).toBeVisible()
})

test('an account change during preparation prevents the device save', async ({ page, context }) => {
 const f = await attendeeOfflineFixture(), auth = await accountApi(context)
 auth.setSession({ identityKey: f.identity, network: 'testnet', expiresAt: new Date(Date.now() + 3600000).toISOString() })
 await context.route('**/api/tickets', r => r.fulfill({ json: { tickets: [f.record], nextOffset: null } }))
 await context.route('**/api/tickets/requests**', r => r.fulfill({ json: { requests: [], nextOffset: null } }))
 await context.route(`**/api/tickets/${f.record.id}`, r => r.fulfill({ json: f.record }))
 await mount(page); await page.getByRole('button', { name: 'View ticket', exact: true }).click()
 await expect(page.getByRole('button', { name: 'Save for offline use', exact: true })).toBeVisible()
 await page.evaluate(() => {
  (document.querySelector('[aria-label="Save for offline use"] button') as HTMLButtonElement).click()
  window.AttendeeOfflineTest.advanceAuthEpoch(null)
 })
 await expect(page.getByRole('alert')).toContainText('account changed')
 expect(await page.evaluate(() => window.AttendeeOfflineTest.listSavedTickets(location.origin))).toEqual([])
})

test('a failed app download retains evidence but never reports offline readiness', async ({ page, context }) => {
 await page.goto('/offline/tickets'); await helpers(page)
 await context.route('**/assets/wallet-*.js', r => r.fulfill({ status: 503, body: 'Synthetic cache failure' }))
 await expect(prepareApp(page)).rejects.toThrow(/App files could not be saved/)
 expect(await page.evaluate(async () => (await caches.keys()).filter(n => n.startsWith('ticketsv-attendee-app-')))).toEqual([])
})

import { createServer } from 'node:http'
test('product worker updates wait for saved-ticket tabs to close', async ({ page, context }) => {
 let worker = await readFile('dist/attendee-offline-worker.js', 'utf8')
 const server = createServer(async (req, res) => {
  const pathname = new URL(req.url!, 'http://localhost').pathname
  try {
   if (pathname === '/attendee-offline-worker.js') { res.setHeader('Content-Type', 'application/javascript'); res.setHeader('Cache-Control', 'no-store'); res.end(worker); return }
   const file = pathname.startsWith('/assets/') && !pathname.includes('..') ? 'dist' + pathname : 'dist/index.html'
   res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(await readFile(file))
  } catch { res.writeHead(404); res.end() }
 })
 await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
 const address = server.address(); if (!address || typeof address === 'string') throw Error('No test server')
 const url = `http://127.0.0.1:${address.port}/offline/tickets`
 try {
  await page.goto(url); await helpers(page); await prepareApp(page); await page.reload(); await helpers(page)
  worker = worker.replace(/ticketsv-attendee-app-[a-f0-9]+/g, 'ticketsv-attendee-app-update-test')
  expect(await page.evaluate(() => window.AttendeeOfflineTest.prepareAttendeeApp(new AbortController().signal))).toBe('waiting')
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/offline/tickets'))?.waiting)).toBe(true)
  await page.close(); const next = await context.newPage(); await next.goto(url)
  await expect.poll(() => next.evaluate(async () => (await navigator.serviceWorker.getRegistration('/offline/tickets'))?.waiting === null)).toBe(true)
  await expect(next.getByRole('heading', { name: /^On this device/ })).toBeVisible()
 } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('cyclic and BigInt corruption with numeric keys cannot hide valid tickets or prevent removal', async ({ page }) => {
 const f = await attendeeOfflineFixture()
 await page.goto('/offline/tickets'); await helpers(page); await seedHeaders(page)
 await page.evaluate(async f => {
  const api = window.AttendeeOfflineTest
  await api.saveAttendeeTicket(api.attendeeEvidence(f.record, f.identity, location.origin), location.origin, new AbortController().signal, () => {})
  await new Promise<void>(resolve => {
   const r = indexedDB.open('ticketsv-attendee-offline-v1'); r.onsuccess = () => {
    const db = r.result, tx = db.transaction('tickets', 'readwrite'), corrupt: { self?: unknown; n: bigint } = { n: 1n }; corrupt.self = corrupt
    tx.objectStore('tickets').put(corrupt, 1); tx.oncomplete = () => { db.close(); resolve() }
   }
  })
 }, { record: f.record, identity: f.identity })
 await page.reload()
 await expect(page.getByRole('heading', { name: 'Harbour Nights', exact: true })).toBeVisible()
 const damaged = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Unreadable ticket' }) })
 await damaged.getByRole('button', { name: 'Remove from this device', exact: true }).click()
 await damaged.getByRole('button', { name: 'Confirm removal', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Unreadable ticket' })).toHaveCount(0)
 await expect(page.getByRole('heading', { name: 'Harbour Nights', exact: true })).toBeVisible()
})
