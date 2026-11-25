import { beforeAll, afterAll, expect, it } from 'vitest'
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { accountApi } from './helpers/account-api.ts'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
let browser: Browser, bundle: string, styles: string
beforeAll(async () => {
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/app-header-browser-entry.tsx'), name: 'AppHeaderTest', formats: ['iife'] },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('Missing bundle')
  bundle = result.output
    .filter(p => p.type === 'chunk')
    .map(p => p.code)
    .join('\n')
  styles = result.output.flatMap(p => (p.type === 'asset' && p.fileName.endsWith('.css') ? [String(p.source)] : [])).join('\n')
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
})
async function setup(context: BrowserContext, hasRequest = false, pending?: 'no-txid' | 'txid') {
  const f = await attendeeOfflineFixture('https://ticketsv.example'),
    event = {
      ...f.record.event,
      id: f.record.eventId,
      image: null,
      revision: 2,
      status: 'draft',
      createdAt: f.record.createdAt,
      updatedAt: f.record.updatedAt,
    }
  await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  const account = await accountApi(context)
  account.setSession({ identityKey: f.record.owner, network: 'testnet', expiresAt: new Date(Date.now() + 3600000).toISOString() })
  account.records.set(event.id, event)
  const request = {
    id: crypto.randomUUID(),
    eventId: event.id,
    event: { ...event, venueIdentity: f.record.owner },
    proof: f.record.attendeeProof,
    createdAt: new Date().toISOString(),
    ticketId: null,
    status: 'requested',
  }
  const prepared = { ...f.record, attendeeRequestId: request.id, status: 'prepared', pkg: undefined, txid: undefined }
  const saved = pending ? [{ ...prepared, status: 'pending', txid: pending === 'txid' ? 'c'.repeat(64) : null }] : []
  let walletCalls = 0,
    starts = 0,
    resets = 0
  await context.route(/localhost:(3321|2121)/, r => {
    walletCalls++
    return r.abort()
  })
  await context.route('**/api/events/*/requests**', r => r.fulfill({ json: { requests: hasRequest ? [request] : [], nextOffset: null } }))
  await context.route('**/api/events/*/issuances**', r => {
    if (r.request().url().endsWith('/start')) {
      starts++
      return r.abort()
    }
    if (r.request().url().endsWith('/reset')) {
      resets++
      return r.abort()
    }
    return r.fulfill({ json: r.request().method() === 'POST' ? prepared : { issuances: saved } })
  })
  const page = await context.newPage()
  await page.goto('https://ticketsv.example/venue/my-events')
  await page.addStyleTag({ content: styles })
  await page.addScriptTag({ content: bundle })
  await page.evaluate('window.AppHeaderTest.mount()')
  await page.getByRole('button', { name: 'Tickets for Harbour Nights', exact: true }).click()
  return { page, walletCalls: () => walletCalls, starts: () => starts, resets: () => resets }
}
it('uses the current event styling and a concise empty requests panel across desktop and phone widths', async () => {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      const { page, walletCalls } = await setup(context)
      await page.getByRole('heading', { name: 'Attendee requests', exact: true }).waitFor()
      expect(await page.getByText('VENUE · TESTNET', { exact: true }).count()).toBe(0)
      await page.getByRole('heading', { name: 'No requests yet', exact: true }).waitFor()
      expect(await page.locator('.venue-issuance.venue-events').count()).toBe(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await mkdir('.superpowers/sdd/issuance', { recursive: true })
      await page.evaluate(() => {
        window.scrollTo(0, 0)
        ;(document.activeElement as HTMLElement)?.blur()
      })
      await page.screenshot({ path: `.superpowers/sdd/issuance/empty-${width}.png`, fullPage: true })
      expect(walletCalls()).toBe(0)
    } finally {
      await context.close()
    }
  }
}, 15000)
it('reviews an attendee request without a wallet call and keeps broadcast gated by explicit consent', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 } })
  try {
    const { page, walletCalls, starts } = await setup(context, true)
    await page.getByRole('button', { name: 'Review new issuance', exact: true }).click()
    const issue = page.getByRole('button', { name: 'Issue and broadcast ticket', exact: true })
    await issue.waitFor()
    expect(await issue.isDisabled()).toBe(true)
    await page.getByRole('checkbox', { name: /I authorize this testnet ticket/ }).check()
    expect(await issue.isEnabled()).toBe(true)
    expect(starts()).toBe(0)
    expect(walletCalls()).toBe(0)
    expect(await page.getByRole('button', { name: 'Review new ticket', exact: true }).count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => {
      window.scrollTo(0, 0)
      ;(document.activeElement as HTMLElement)?.blur()
    })
    await page.screenshot({ path: '.superpowers/sdd/issuance/review-mobile.png', fullPage: true })
  } finally {
    await context.close()
  }
}, 10000)
it('offers a wallet check for a started attempt with no saved transaction and never resets without one', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 } })
  try {
    const { page, walletCalls, resets } = await setup(context, false, 'no-txid')
    const check = page.getByRole('button', { name: 'Check wallet', exact: true })
    await check.waitFor()
    expect(walletCalls()).toBe(0)
    await check.click()
    await page.getByRole('alert').waitFor()
    expect(resets()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally {
    await context.close()
  }
}, 10000)
it('offers recovery, never a second issue, when a transaction is saved without evidence', async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 } })
  try {
    const { page } = await setup(context, false, 'txid')
    await page.getByText(/no transaction is repeated/).waitFor()
    expect(await page.getByRole('button', { name: 'Recover ticket', exact: true }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Issue and broadcast ticket', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Check wallet', exact: true }).count()).toBe(0)
  } finally {
    await context.close()
  }
}, 10000)
