import { test, expect, type Page } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { attendeeEvidence } from '../src/offline/attendee-evidence.ts'
import { fromAttendee } from '../src/handoff/evidence.ts'
import { sourceKey } from '../src/handoff/store.ts'
import type { SenderRecord } from '../src/handoff/types.ts'

declare global { interface Window { HandoffStorageTest: typeof import('./helpers/handoff-storage-browser-entry.ts') } }
let bundle: string
// Production evidence validation, IndexedDB transactions and QR libraries run unchanged.
// Synthetic venue/ticket fixtures have real signatures; these tests make no mining claim.
test.beforeAll(async () => {
 const built = await build({ configFile: false, publicDir: false, logLevel: 'silent', define: { 'process.env.NODE_ENV': '"production"' }, build: { write: false, minify: false, lib: { entry: resolve('tests/helpers/handoff-storage-browser-entry.ts'), name: 'HandoffStorageTest', formats: ['iife'] } } })
 const result = Array.isArray(built) ? built[0] : built
 if (!('output' in result)) throw Error('No handoff storage test bundle')
 bundle = result.output.filter(part => part.type === 'chunk').map(part => part.code).join('\n')
})
async function mount(page: Page) {
 await page.route('**/handoff-storage-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Handoff storage test</title>' }))
 await page.goto('/handoff-storage-test')
 await page.addScriptTag({ content: bundle })
}
async function sender(): Promise<SenderRecord> {
 const f = await attendeeOfflineFixture(), ticket = fromAttendee(attendeeEvidence(f.record, f.identity, 'http://127.0.0.1:4175'))
 return { kind: 'ticketsv-handoff-sender', version: 1, id: sourceKey(ticket), revision: 0, ticket }
}

test('two tabs atomically create one source record and claim one funding attempt', async ({ page, context }) => {
 const record = await sender(); await mount(page)
 const other = await context.newPage(); await mount(other)
 const created = await Promise.all([page, other].map(p => p.evaluate(async record => {
  try { await window.HandoffStorageTest.senderStore.save(record, undefined); return true } catch { return false }
 }, record)))
 expect(created.filter(Boolean)).toHaveLength(1)
 const claimed = await Promise.all([page, other].map((p, i) => p.evaluate(async ({ record, i }) => {
  try {
   await window.HandoffStorageTest.senderStore.save({ ...record, revision: 1, fundAttempt: { id: `tab-${i}`, outcome: 'pending', startedAt: new Date().toISOString() } }, 0)
   return true
  } catch { return false }
 }, { record, i })))
 expect(claimed.filter(Boolean)).toHaveLength(1)
 const stored = await page.evaluate(id => window.HandoffStorageTest.senderStore.load(id), record.id)
 expect(stored?.revision).toBe(1); expect(stored?.fundAttempt?.outcome).toBe('pending')
 // A fresh page and a caller-modified object cannot reset the source claim.
 await mount(other)
 const blocked = await other.evaluate(async ({ original, stored }) => {
  const store = window.HandoffStorageTest.senderStore, results: boolean[] = []
  for (const [next, expected] of [
   [{ ...original, revision: 1 }, 0],
   [{ ...stored!, revision: 2, fundAttempt: undefined }, 1],
   [{ ...stored!, revision: 2, fundAttempt: { ...stored!.fundAttempt!, id: 'replacement' } }, 1],
   [{ ...stored!, revision: 2, ticket: { ...stored!.ticket, event: { ...stored!.ticket.event, name: 'Changed source evidence' } } }, 1],
   [{ ...original, id: original.id + ':new-run' }, undefined],
  ] as const) {
   try { await store.save(next, expected); results.push(false) } catch { results.push(true) }
  }
  return results
 }, { original: record, stored })
 expect(blocked).toEqual([true, true, true, true, true])
 expect(await page.evaluate(id => window.HandoffStorageTest.senderStore.load(id), record.id)).toEqual(stored)
})

test('unknown attempts survive reload and immutable outcomes are enforced inside the transaction', async ({ page }) => {
 const record = await sender(); await mount(page)
 const saved = await page.evaluate(async record => {
  const store = window.HandoffStorageTest.senderStore, startedAt = new Date().toISOString()
  await store.save(record, undefined)
  const pending = { ...record, revision: 1, fundAttempt: { id: 'persistent-attempt', outcome: 'pending' as const, startedAt } }
  await store.save(pending, 0)
  const unknown = { ...pending, revision: 2, fundAttempt: { ...pending.fundAttempt, outcome: 'unknown' as const, finishedAt: new Date().toISOString() } }
  await store.save(unknown, 1)
  return unknown
 }, record)
 await mount(page)
 expect(await page.evaluate(id => window.HandoffStorageTest.senderStore.load(id), record.id)).toEqual(saved)
 const blocked = await page.evaluate(async saved => {
  const store = window.HandoffStorageTest.senderStore
  const next = { ...saved, revision: 3, fundAttempt: { id: saved.fundAttempt.id, outcome: 'pending' as const, startedAt: saved.fundAttempt.startedAt } }
  try { await store.save(next, 2); return false } catch { return true }
 }, saved)
 expect(blocked).toBe(true)
 expect(await page.evaluate(id => window.HandoffStorageTest.senderStore.load(id), record.id)).toEqual(saved)
})

test('corrupt existing records fail closed for reads, listing and both fresh and revised writes', async ({ page }) => {
 const record = await sender(); await mount(page)
 await page.evaluate(async record => {
  await window.HandoffStorageTest.senderStore.save(record, undefined)
  await new Promise<void>((resolve, reject) => {
   const request = indexedDB.open('ticketsv-handoff-senders-v1', 1)
   request.onerror = () => reject(request.error)
   request.onsuccess = () => {
    const db = request.result, tx = db.transaction('records', 'readwrite')
    tx.objectStore('records').put({ damaged: true, revision: 0 }, record.id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => { db.close(); reject(tx.error) }
   }
  })
 }, record)
 await mount(page)
 const rejected = await page.evaluate(async record => {
  const store = window.HandoffStorageTest.senderStore, results: boolean[] = []
  for (const operation of [() => store.load(record.id), () => store.list(), () => store.save(record, undefined), () => store.save({ ...record, revision: 1 }, 0)]) {
   try { await operation(); results.push(false) } catch { results.push(true) }
  }
  return results
 }, record)
 expect(rejected).toEqual([true, true, true, true])
 const raw = await page.evaluate(id => new Promise<unknown>((resolve, reject) => {
  const request = indexedDB.open('ticketsv-handoff-senders-v1', 1)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => {
   const db = request.result, tx = db.transaction('records'), get = tx.objectStore('records').get(id)
   tx.oncomplete = () => { db.close(); resolve(get.result) }
   tx.onabort = () => { db.close(); reject(tx.error) }
  }
 }), record.id)
 expect(raw).toEqual({ damaged: true, revision: 0 })
})

test('real QR images decode and assemble Unicode JSON out of order with duplicate frames', async ({ page }) => {
 await mount(page)
 const result = await page.evaluate(async () => {
  const api = window.HandoffStorageTest, text = JSON.stringify({ kind: 'exchange-test', event: 'Harbour Nights', description: 'Ticket 🧡 — Lagos '.repeat(180) })
  const frames = api.encodeFrames(text), assembler = new api.FrameAssembler(), decoded: string[] = []
  for (const frame of frames) {
   const canvas = document.createElement('canvas')
   await api.QRCode.toCanvas(canvas, frame, { errorCorrectionLevel: 'M', width: 480, margin: 4 })
   const pixels = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
   const code = api.decodeQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'dontInvert' })
   if (!code) throw Error('Generated QR frame could not be decoded')
   if (code.data !== frame) throw Error('QR decoder changed frame bytes')
   decoded.push(code.data)
  }
  let assembled: string | undefined
  assembler.add(decoded.at(-1)!)
  assembler.add(decoded.at(-1)!)
  const duplicatesCount = assembler.received
  for (const frame of decoded.toReversed()) assembled = assembler.add(frame) ?? assembled
  const complete = { expected: text, assembled, received: assembler.received, total: assembler.total, frameCount: frames.length, duplicatesCount }
  assembler.reset()
  return { ...complete, reset: { received: assembler.received, total: assembler.total } }
 })
 expect(result.frameCount).toBeGreaterThan(1)
 expect(result.assembled).toBe(result.expected)
 expect(result.received).toBe(result.total); expect(result.total).toBe(result.frameCount)
 expect(result.duplicatesCount).toBe(1)
 expect(result.reset).toEqual({ received: 0, total: 0 })
})

test('decoded QR frames from another exchange cannot contaminate an active assembly', async ({ page }) => {
 await mount(page)
 const result = await page.evaluate(async () => {
  const api = window.HandoffStorageTest, first = api.encodeFrames(JSON.stringify({ text: 'first'.repeat(500) })), other = api.encodeFrames(JSON.stringify({ text: 'other'.repeat(500) }))
  const assembler = new api.FrameAssembler(); assembler.add(first[0])
  const canvas = document.createElement('canvas')
  await api.QRCode.toCanvas(canvas, other[1], { errorCorrectionLevel: 'M', width: 480, margin: 4 })
  const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height), code = api.decodeQR(pixels.data, pixels.width, pixels.height)
  if (!code) throw Error('Mixed QR frame did not decode')
  let rejected = false
  try { assembler.add(code.data) } catch { rejected = true }
  let complete: string | undefined
  for (const frame of first.slice(1)) complete = assembler.add(frame) ?? complete
  return { rejected, complete, expected: JSON.stringify({ text: 'first'.repeat(500) }) }
 })
 expect(result.rejected).toBe(true); expect(result.complete).toBe(result.expected)
})
