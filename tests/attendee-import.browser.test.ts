import { test, expect, type Page, type BrowserContext, type Route } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { accountApi } from './helpers/account-api.ts'
import { makeSnapshot, parseProviderHeader } from '../src/headers/validate.ts'
import header from './fixtures/headers/woc-1762324.json' with { type: 'json' }
declare global { interface Window { AttendeeImportTest: typeof import('./helpers/attendee-import-browser-entry.tsx') } }
const snapshot = makeSnapshot([parseProviderHeader(header, 'whatsonchain', header.height)])
let bundle: string, styles: string[]
test.beforeAll(async () => {
 const target = resolve('src/verification/signing-spv.ts')
 const built = await build({ configFile: false, publicDir: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_SHARED_HEADERS': '"false"' }, plugins: [{ name: 'synthetic-mining-boundary', async load(id) {
  if (id === target) { const source = await readFile(target, 'utf8'); return source.slice(0, source.indexOf('export async function verifySigningEvidence')) + `export async function verifySigningEvidence(e,snapshot){if(!snapshot)throw Error('Missing headers');return {subjectMined:!!Transaction.fromAtomicBEEF(e.atomicBeef).merklePath}}` }
 } }], build: { write: false, minify: false, lib: { entry: resolve('tests/helpers/attendee-import-browser-entry.tsx'), name: 'AttendeeImportTest', formats: ['iife'] } } })
 const output = Array.isArray(built) ? built[0] : built
 if (!('output' in output)) throw Error('No test bundle')
 bundle = output.output.filter(x => x.type === 'chunk').map(x => x.code).join('\n')
 styles = [...(await readFile('dist/index.html', 'utf8')).matchAll(/href="([^"]+\.css)"/g)].map(match => match[1])
})
type Fixture = Awaited<ReturnType<typeof attendeeOfflineFixture>>
async function setup(page: Page, context: BrowserContext, f: Fixture) {
 const auth = await accountApi(context)
 auth.setSession({ identityKey: f.identity, network: 'testnet', expiresAt: new Date(Date.now() + 3600000).toISOString() })
 await context.route('**/api/tickets', r => r.fulfill({ json: { tickets: [f.record], nextOffset: null } }))
 await context.route('**/api/tickets/requests**', r => r.fulfill({ json: { requests: [], nextOffset: null } }))
 await context.route(`**/api/tickets/${f.record.id}`, r => r.fulfill({ json: f.record }))
 await context.route(url => url.pathname === '/tickets', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="test-root"></div>' }))
 await mount(page)
}
async function mount(page: Page) {
 await page.goto('/tickets'); await page.addScriptTag({ content: bundle })
 for (const url of styles) await page.addStyleTag({ url })
 await page.evaluate(async snapshot => new Promise<void>((resolve, reject) => {
  const r = indexedDB.open('counterfoil-spv-experiment-v1', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('snapshots')
  r.onsuccess = () => { const db = r.result, tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(snapshot, 'accepted'); tx.oncomplete = () => { db.close(); resolve() }; tx.onabort = () => reject(tx.error) }
 }), snapshot)
 await page.evaluate(() => window.AttendeeImportTest.render())
 await page.getByRole('button', { name: 'View ticket', exact: true }).click()
}
async function wallet(context: BrowserContext, f: Fixture, mode: 'normal' | 'lost' | 'absent' | 'hold' = 'normal') {
 const calls: string[] = [], mutations: unknown[] = [], key = f.record.request.recipient
 let owned = false, held: Route | undefined
 await context.route('http://localhost:3321/**', async r => {
  if (r.request().method() === 'OPTIONS') { await r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }); return }
  const method = new URL(r.request().url()).pathname.split('/').at(-1)!, args = r.request().postDataJSON(); calls.push(method)
  if (method === 'internalizeAction') { mutations.push(args); owned = mode !== 'absent'; if (mode === 'lost' || mode === 'absent') { await r.abort(); return }; if (mode === 'hold') { held = r; return } }
  const results: Record<string, unknown> = {
   getNetwork: { network: 'testnet' }, getVersion: { version: 'wallet-brc100-1.0.0' }, getPublicKey: { publicKey: args.identityKey ? f.identity : key.publicKey },
   listOutputs: { totalOutputs: owned ? 1 : 0, outputs: owned ? [{ outpoint: `${f.record.txid}.0`, satoshis: 1, spendable: true, lockingScript: f.tx.outputs[0].lockingScript.toHex(), customInstructions: JSON.stringify({ type: 'PushDrop', protocolID: key.protocolID, keyID: key.keyID, counterparty: key.counterparty }) }] : [] }, internalizeAction: { accepted: true },
  }
  if (!(method in results)) throw Error('Unexpected wallet action: ' + method)
  await r.fulfill({ json: results[method], headers: { 'Access-Control-Allow-Origin': '*' } })
 })
 return { calls, mutations, held: () => held }
}
const panel = (page: Page) => page.getByRole('region', { name: 'Prepare for handoff', exact: true })
const add = (page: Page) => panel(page).getByRole('button', { name: 'Add ticket to wallet', exact: true })
async function review(page: Page) { await panel(page).getByRole('button', { name: 'Check wallet readiness', exact: true }).click(); await expect(add(page)).toBeDisabled(); await panel(page).getByRole('checkbox').check() }

test('Prepare requires explicit consent, imports once and preserves acceptance on reload', async ({ page, context }) => {
 const f = await attendeeOfflineFixture(), w = await wallet(context, f)
 await setup(page, context, f)
 await expect(panel(page).getByRole('button', { name: 'Check wallet readiness', exact: true })).toBeVisible()
 expect(w.calls).toEqual([])
 await review(page); expect(w.mutations).toEqual([])
 await panel(page).scrollIntoViewIfNeeded()
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
 await panel(page).screenshot({ path: test.info().outputPath('prepare-wallet-review.png') })
 await add(page).click()
 await expect(panel(page).getByText('Import response: accepted', { exact: true })).toBeVisible()
 await expect(panel(page).getByText('Latest wallet observation: present', { exact: true })).toBeVisible()
 await expect(panel(page)).toContainText('Fee preparation is next')
 expect(w.mutations).toHaveLength(1)
 expect(w.mutations[0]).toMatchObject({ outputs: [{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'ticketsv-tickets' } }] })
 const count = w.calls.length; await mount(page)
 await expect(panel(page).getByText('Import response: accepted', { exact: true })).toBeVisible()
 expect(w.calls).toHaveLength(count); await expect(add(page)).toHaveCount(0)
})
for (const mode of ['lost', 'absent'] as const) test(`unknown import survives reload and ${mode} reconciliation without retry`, async ({ page, context }) => {
 const f = await attendeeOfflineFixture(), w = await wallet(context, f, mode)
 await setup(page, context, f); await review(page); await add(page).click()
 await expect(panel(page).getByText('Import response: unknown', { exact: true })).toBeVisible()
 const count = w.calls.length; await mount(page)
 await expect(panel(page).getByText('Import response: unknown', { exact: true })).toBeVisible(); expect(w.calls).toHaveLength(count)
 await panel(page).getByRole('button', { name: 'Recheck wallet record', exact: true }).click()
 await expect(panel(page).getByText(`Latest wallet observation: ${mode === 'lost' ? 'present' : 'absent'}`, { exact: true })).toBeVisible()
 await expect(add(page)).toHaveCount(0); expect(w.mutations).toHaveLength(1)
})
test('two tabs cannot claim the same ticket and a damaged record blocks import', async ({ page, context }) => {
 const f = await attendeeOfflineFixture(), w = await wallet(context, f)
 await setup(page, context, f); const other = await context.newPage(); await mount(other)
 const results = await Promise.all([page, other].map(p => p.evaluate(async f => {
  const api = window.AttendeeImportTest, e = api.attendeeEvidence(f.record, f.identity, location.origin)
  try { await api.attendeeImportStore.claim(e); return true } catch { return false }
 }, { record: f.record, identity: f.identity })))
 expect(results.filter(Boolean)).toHaveLength(1); expect(w.mutations).toEqual([])
 await mount(page); await expect(panel(page).getByText('Import response: pending', { exact: true })).toBeVisible(); await expect(add(page)).toHaveCount(0)
 await page.evaluate(async f => {
  const api = window.AttendeeImportTest, key = api.importKey(api.attendeeEvidence(f.record, f.identity, location.origin))
  await new Promise<void>(resolve => { const r = indexedDB.open('ticketsv-attendee-import-v1'); r.onsuccess = () => { const db = r.result, tx = db.transaction('imports', 'readwrite'); tx.objectStore('imports').put({ damaged: true }, key); tx.oncomplete = () => { db.close(); resolve() } } })
 }, { record: f.record, identity: f.identity })
 await mount(page); await expect(panel(page).getByRole('alert')).toBeVisible(); await expect(panel(page).getByRole('button', { name: 'Check wallet readiness', exact: true })).toBeDisabled()
 expect(w.mutations).toEqual([])
})
test('cancelling an in-flight import retains unknown and late acceptance cannot enable retry', async ({ page, context }) => {
 const f = await attendeeOfflineFixture(), w = await wallet(context, f, 'hold')
 await setup(page, context, f); await review(page); await add(page).click(); await expect.poll(() => !!w.held()).toBe(true)
 await page.getByRole('button', { name: 'Cancel', exact: true }).click()
 await expect(panel(page).getByRole('alert')).toContainText('does not undo')
 await w.held()!.fulfill({ json: { accepted: true }, headers: { 'Access-Control-Allow-Origin': '*' } }).catch(() => {})
 await mount(page); await expect(panel(page).getByText('Import response: unknown', { exact: true })).toBeVisible()
 await expect(add(page)).toHaveCount(0); expect(w.mutations).toHaveLength(1)
})
test('changed source cannot reuse a saved wallet observation or enable another import', async ({ page, context }) => {
 const f = await attendeeOfflineFixture(), w = await wallet(context, f)
 await setup(page, context, f); await review(page); await add(page).click()
 await expect(panel(page).getByText('Latest wallet observation: present', { exact: true })).toBeVisible()
 f.record.event.name = 'A different saved review'
 await mount(page)
 await expect(panel(page).getByRole('alert')).toContainText('evidence differs')
 await expect(panel(page).getByText('Latest wallet observation: present', { exact: true })).toHaveCount(0)
 await expect(panel(page).getByRole('button', { name: 'Check wallet readiness', exact: true })).toBeDisabled()
 expect(w.mutations).toHaveLength(1)
})
