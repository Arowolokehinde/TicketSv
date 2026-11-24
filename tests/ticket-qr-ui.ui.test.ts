import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { makeSnapshot, parseProviderHeader } from '../src/headers/validate.ts'
import header from './fixtures/headers/woc-1762324.json' with { type: 'json' }
import { decodeStaticQR } from '../src/handoff/static-qr.ts'
import { normalizeScannerTicket } from '../src/scanner/verify.ts'
import { accountApi } from './helpers/account-api.ts'
declare global {
  interface Window {
    TicketQRTest: typeof import('./helpers/ticket-qr-browser-entry.tsx')
  }
}
let browser: Browser, bundle: string, css: string
beforeAll(async () => {
  const target = resolve('src/verification/signing-spv.ts')
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.VITE_SHARED_HEADERS': '"false"' },
    plugins: [
      {
        name: 'synthetic-qr-anchor',
        async load(id) {
          if (id === target) {
            const code = await readFile(target, 'utf8')
            return (
              code.slice(0, code.indexOf('export async function verifySigningEvidence')) +
              `export async function verifySigningEvidence(e,snapshot){if(!snapshot)throw Error('Missing headers');return {subjectMined:!!Transaction.fromAtomicBEEF(e.atomicBeef).merklePath}}`
            )
          }
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/ticket-qr-browser-entry.tsx'), name: 'TicketQRTest', formats: ['iife'] },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('No bundle')
  bundle = result.output
    .filter(p => p.type === 'chunk')
    .map(p => p.code)
    .join('\n')
  css = result.output.flatMap(p => (p.type === 'asset' && p.fileName.endsWith('.css') ? [String(p.source)] : [])).join('\n')
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
})
it('shows saved ticket QR offline, round-trips the static code into scanner input, and makes no wallet or network calls', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 850 } }),
    page = await context.newPage(),
    f = await attendeeOfflineFixture()
  let calls = 0
  page.setDefaultTimeout(3000)
  try {
    await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    context.on('request', () => calls++)
    await page.goto('http://127.0.0.1:4175/offline/tickets')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: bundle })
    await page.evaluate(
      async ({ record, owner, snapshot }) => {
        const api = window.TicketQRTest
        await api.saveSnapshot(snapshot)
        await api.saveAttendeeTicket(
          api.attendeeEvidence(record, owner, location.origin),
          location.origin,
          new AbortController().signal,
          () => {},
        )
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
        api.mount()
      },
      { record: f.record, owner: f.identity, snapshot: makeSnapshot([parseProviderHeader(header, 'whatsonchain', header.height)]) },
    )
    await page.getByRole('button', { name: 'Open ticket', exact: true }).click()
    const show = page.getByRole('button', { name: 'Show ticket QR', exact: true })
    await show.waitFor()
    const before = calls
    await show.click()
    const dialog = page.getByRole('dialog', { name: 'Harbour Nights ticket QR', exact: true })
    await dialog.waitFor()
    const img = dialog.getByRole('img')
    await img.waitFor()
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>('dialog img')
      return !!img?.complete && img.naturalWidth > 0
    })
    const code = await page.evaluate(() => window.TicketQRTest.readFrame())
    expect(code).toBeTruthy()
    const text = decodeStaticQR(code!)
    expect(await dialog.getByRole('button', { name: /frames/ }).count()).toBe(0)
    expect(text).toBeTruthy()
    expect(normalizeScannerTicket(text)).toEqual(f.record.pkg)
    expect(await dialog.getByRole('button', { name: /Save .* file/ }).count()).toBe(0)
    expect(calls).toBe(before)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await mkdir('.superpowers/sdd/ticket-qr', { recursive: true })
    await page.screenshot({ path: '.superpowers/sdd/ticket-qr/offline-phone.png' })
    await dialog.getByRole('button', { name: 'Close ticket QR', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    expect(await show.isVisible()).toBe(true)
    expect(calls).toBe(before)
  } finally {
    await context.close()
  }
}, 20000)
it('reveals ticket presentation on Dashboard after mined verification without any wallet operation', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    f = await attendeeOfflineFixture()
  let walletCalls = 0
  try {
    await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    const auth = await accountApi(context)
    auth.setSession({ identityKey: f.identity, network: 'testnet', expiresAt: new Date(Date.now() + 3600000).toISOString() })
    await context.route('**/api/tickets', r => r.fulfill({ json: { tickets: [f.record], nextOffset: null } }))
    await context.route('**/api/tickets/requests', r => r.fulfill({ json: { requests: [], nextOffset: null } }))
    await context.route(
      url => url.pathname === `/api/tickets/${f.record.id}`,
      r => r.fulfill({ json: f.record }),
    )
    await context.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/tx/**', r =>
      r.fulfill({
        json: {
          txid: f.record.txid,
          txStatus: 'MINED',
          blockHeight: 1762324,
          blockHash: '00'.repeat(32),
          merklePath: f.tx.merklePath!.toHex(),
        },
      }),
    )
    await context.route(/localhost:(3321|2121)/, r => {
      walletCalls++
      return r.abort()
    })
    await page.goto('http://127.0.0.1:4175/tickets')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(
      async snapshot => {
        await window.TicketQRTest.saveSnapshot(snapshot)
        window.TicketQRTest.mount()
      },
      makeSnapshot([parseProviderHeader(header, 'whatsonchain', header.height)]),
    )
    await page.getByRole('button', { name: 'View ticket', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Show ticket QR', exact: true }).count()).toBe(0)
    await page.getByRole('button', { name: 'Check mining evidence', exact: true }).click()
    await page.getByRole('button', { name: 'Verify ticket', exact: true }).click()
    await page.getByRole('button', { name: 'Show ticket QR', exact: true }).click()
    await page.getByRole('dialog', { name: 'Harbour Nights ticket QR', exact: true }).waitFor()
    expect(walletCalls).toBe(0)
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
  } finally {
    await context.close()
  }
}, 10000)
it('does not present a QR when saved ticket signatures fail a fresh local check', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    f = await attendeeOfflineFixture(),
    other = await attendeeOfflineFixture()
  try {
    await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1:4175/offline/tickets')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(
      async ({ record, owner, signature, snapshot }) => {
        const api = window.TicketQRTest
        await api.saveSnapshot(snapshot)
        const evidence = api.attendeeEvidence(record, owner, location.origin)
        await api.saveAttendeeTicket(evidence, location.origin, new AbortController().signal, () => {})
        evidence.pkg.issuance.signatureBase64 = signature
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('ticketsv-attendee-offline-v1')
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction('tickets', 'readwrite')
            tx.objectStore('tickets').put(evidence, `${owner}:${record.id}`)
            tx.oncomplete = () => {
              db.close()
              resolve()
            }
            tx.onabort = () => reject(tx.error)
          }
        })
        api.mount()
      },
      {
        record: f.record,
        owner: f.identity,
        signature: other.record.pkg!.issuance.signatureBase64,
        snapshot: makeSnapshot([parseProviderHeader(header, 'whatsonchain', header.height)]),
      },
    )
    await page.getByRole('button', { name: 'Open ticket', exact: true }).click()
    await page.getByRole('heading', { name: 'Saved ticket verification: rejected', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Show ticket QR', exact: true }).count()).toBe(0)
  } finally {
    await context.close()
  }
}, 10000)
