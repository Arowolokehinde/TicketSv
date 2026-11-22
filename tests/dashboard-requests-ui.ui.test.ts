import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { accountApi } from './helpers/account-api.ts'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
let browser: Browser, bundle: string, css: string
beforeAll(async () => {
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/app-header-browser-entry.tsx'), name: 'RequestsTest', formats: ['iife'] },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('No app bundle')
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
it('presents request status and actions clearly on desktop and phone while keeping one saved-ticket shortcut', async () => {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }),
      page = await context.newPage(),
      f = await attendeeOfflineFixture('https://ticketsv.example')
    let walletCalls = 0
    try {
      await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
      const account = await accountApi(context)
      account.setSession({ identityKey: f.identity, network: 'testnet', expiresAt: new Date(Date.now() + 3600000).toISOString() })
      const requests = ['complete', 'requested', 'prepared', 'pending'].map((status, i) => ({
        id: crypto.randomUUID(),
        eventId: f.record.eventId,
        event: {
          ...f.record.event,
          name: i === 0 ? 'Harbour Nights' : 'An evening of music, friends and memories together',
          id: f.record.eventId,
          revision: 2,
          venueIdentity: f.record.owner,
        },
        proof: f.record.attendeeProof,
        createdAt: f.record.createdAt,
        ticketId: status === 'complete' ? f.record.id : null,
        status,
      }))
      await context.route('**/api/tickets', r => r.fulfill({ json: { tickets: [f.record], nextOffset: null } }))
      await context.route('**/api/tickets/requests', r => r.fulfill({ json: { requests, nextOffset: null } }))
      await context.route(`**/api/tickets/${f.record.id}`, r => r.fulfill({ json: f.record }))
      await context.route(/localhost:(3321|2121)/, r => {
        walletCalls++
        return r.abort()
      })
      await page.goto('https://ticketsv.example/tickets')
      await page.addStyleTag({ content: css })
      await page.addScriptTag({ content: bundle })
      await page.evaluate('window.RequestsTest.mount()')
      const section = page.getByRole('region', { name: 'Your requests', exact: true })
      await section.waitFor({ timeout: 2500 })
      expect(await section.locator('article').count()).toBe(4)
      for (const label of ['Ticket delivered', 'Awaiting approval', 'Under review', 'Issuance pending'])
        expect(await section.getByText(label, { exact: true }).isVisible()).toBe(true)
      expect(await section.getByRole('link', { name: 'Event details', exact: true }).count()).toBe(3)
      await section.getByRole('button', { name: 'View ticket', exact: true }).click()
      await page.getByRole('region', { name: 'Selected ticket', exact: true }).waitFor()
      expect(await page.getByRole('link', { name: 'Offline tickets', exact: true }).count()).toBe(1)
      expect(await page.getByRole('link', { name: 'Open offline tickets', exact: true }).count()).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(walletCalls).toBe(0)
      await mkdir('.superpowers/sdd/dashboard-requests', { recursive: true })
      await section.screenshot({ path: `.superpowers/sdd/dashboard-requests/requests-${width}.png` })
    } finally {
      await context.close()
    }
  }
}, 15000)
