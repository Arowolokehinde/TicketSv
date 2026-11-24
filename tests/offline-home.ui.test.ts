import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { handoffFixture } from './helpers/handoff-fixture.ts'
import { newSettlement, readSettlement } from '../src/handoff/settlement.ts'
import { recipientKey, sourceKey } from '../src/handoff/store.ts'
import type { RecipientRecord, SenderRecord } from '../src/handoff/types.ts'
declare global {
  interface Window {
    DashboardHandoffTest: typeof import('./helpers/dashboard-handoff-browser-entry.tsx')
  }
}
// The offline home reads saved records only: no wallet, API or provider request.
let browser: Browser, bundle: string
beforeAll(async () => {
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/dashboard-handoff-browser-entry.tsx'), name: 'DashboardHandoffTest', formats: ['iife'] },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('Missing offline home test bundle')
  bundle = result.output
    .filter(p => p.type === 'chunk')
    .map(p => p.code)
    .join('\n')
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
})
async function setup(context: BrowserContext) {
  let requests = 0
  await context.route('**/*', route => {
    if (route.request().resourceType() !== 'document') requests++
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' })
  })
  return { requests: () => requests }
}
async function open(page: Page, path: string) {
  await page.goto('http://127.0.0.1:4175' + path)
  await page.addScriptTag({ content: bundle })
}
async function records() {
  const f = await handoffFixture(true),
    at = new Date().toISOString()
  const recipient: RecipientRecord = {
    kind: 'ticketsv-handoff-recipient',
    version: 1,
    id: recipientKey(f.request),
    revision: 0,
    request: f.request,
    ticket: f.ticket,
  }
  const settlement = readSettlement({
    ...newSettlement(f.ticket),
    import: { id: 'completed-import', startedAt: at, finishedAt: at, outcome: 'complete' },
    wallet: { state: 'present', checkedAt: at, reason: 'Matching ticket and receiving instructions found.' },
  })
  const funded: SenderRecord = {
    kind: 'ticketsv-handoff-sender',
    version: 1,
    id: sourceKey(f.ticket),
    revision: 0,
    ticket: f.ticket,
    fundAttempt: { id: 'synthetic-fee-attempt', outcome: 'complete', startedAt: at, finishedAt: at },
    funding: {
      key: f.ticket.pkg.request.recipient,
      amount: 1,
      policy: { maxTxBytes: 100000, feeSatoshis: 1, feeBytes: 1000 },
      txid: f.ticket.pkg.current.txid,
      index: 0,
      beef: f.ticket.pkg.atomicBeefBase64,
    },
  }
  const unknown: SenderRecord = {
    kind: 'ticketsv-handoff-sender',
    version: 1,
    id: sourceKey(f.ticket),
    revision: 0,
    ticket: f.ticket,
    fundAttempt: { id: 'unknown-fee-attempt', outcome: 'unknown', startedAt: at, finishedAt: at },
  }
  return { f, recipient, settlement, funded, unknown }
}
async function seed(page: Page, recipient: RecipientRecord, settlement: unknown, sender: SenderRecord) {
  await page.evaluate(
    async ({ recipient, settlement, sender }) => {
      const api = window.DashboardHandoffTest
      await api.recipientStore.save(recipient, undefined)
      await api.settlementStore.save(settlement as Parameters<typeof api.settlementStore.save>[0], undefined)
      await api.senderStore.save(sender, undefined)
    },
    { recipient, settlement, sender },
  )
}

it('shows each ticket with its status, handoffs in progress with their next step, the storage line and activity', async () => {
  const { recipient, settlement, funded } = await records(),
    context = await browser.newContext(),
    page = await context.newPage(),
    network = await setup(context)
  try {
    await open(page, '/offline/tickets')
    await seed(page, recipient, settlement, funded)
    await page.evaluate(() => window.DashboardHandoffTest.mount())
    const ticket = page.locator('article').filter({ hasText: recipient.ticket!.event.name })
    await ticket.getByText('In your wallet', { exact: true }).waitFor({ timeout: 1500 })
    expect(await page.getByRole('region', { name: /^Account / }).count()).toBe(1)
    const progress = page.getByRole('region', { name: 'Handoffs in progress' })
    const next = progress.getByRole('link', { name: 'Sign offline transfer' })
    expect(await next.getAttribute('href')).toBe('/offline/handoff?source=' + encodeURIComponent(funded.id))
    expect(await page.locator('.saved-library-storage').innerText()).toMatch(
      /Kept on this device|may clear TicketSV’s data|does not say whether it keeps/,
    )
    await page.getByText('Activity on this device', { exact: true }).click()
    await page.getByText('No checks recorded on this device.', { exact: true }).waitFor()
    await open(page, '/offline/handoff?source=' + encodeURIComponent(funded.id))
    await page.evaluate(() => window.DashboardHandoffTest.mount())
    await page.getByRole('heading', { name: 'Send to its next holder.', exact: true }).waitFor({ timeout: 1500 })
    expect(await page.getByLabel('Choose handoff ticket', { exact: true }).inputValue()).toBe(funded.id)
    expect(network.requests()).toBe(0)
  } finally {
    await context.close()
  }
}, 15000)

const offline = (page: Page) => page.evaluate(() => Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true }))

it('says what each held ticket can do offline, under a heading like the other pages', async () => {
  const { recipient, settlement, funded } = await records(),
    context = await browser.newContext(),
    page = await context.newPage(),
    network = await setup(context)
  try {
    await open(page, '/offline/tickets')
    await seed(page, recipient, settlement, funded)
    await offline(page)
    await page.evaluate(() => window.DashboardHandoffTest.mount())
    await page.getByRole('heading', { level: 1, name: 'Offline tickets.' }).waitFor({ timeout: 1500 })
    const ticket = page.locator('article').filter({ hasText: recipient.ticket!.event.name })
    // No headers are saved here; the ready states are covered in tests/offline-home.test.ts.
    await ticket.getByText("Block headers for this ticket aren't saved. Needs internet.", { exact: true }).waitFor({ timeout: 1500 })
    // The fee is mined but the device wasn't prepared, exactly as the Transfer page would say.
    await ticket.getByText('Transfer needs internet first: select Check mining and prepare device.', { exact: true }).waitFor()
    expect(await ticket.getByRole('link', { name: 'Transfer offline' }).count()).toBe(0)
    // Signing works offline, so its row isn't tagged.
    const row = page.getByRole('region', { name: 'Handoffs in progress' }).locator('li', { hasText: 'Sign offline transfer' })
    await row.waitFor()
    expect(await row.getByText('Needs internet', { exact: true }).count()).toBe(0)
    expect(network.requests()).toBe(0)
  } finally {
    await context.close()
  }
}, 15000)

it('remove all keeps a handoff whose wallet outcome is unknown and says why', async () => {
  const { recipient, settlement, unknown } = await records(),
    context = await browser.newContext(),
    page = await context.newPage(),
    network = await setup(context)
  try {
    await open(page, '/offline/tickets')
    await seed(page, recipient, settlement, unknown)
    await page.evaluate(() => window.DashboardHandoffTest.mount())
    await page.getByRole('button', { name: 'Remove all from this device', exact: true }).click()
    await page.getByText('Anything with an unfinished or unknown wallet, signing or publishing step is kept.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Remove all', exact: true }).click()
    const kept = page.getByRole('region', { name: 'Kept on this device' })
    await kept.getByText('A wallet step is unfinished or its outcome is unknown.', { exact: false }).waitFor({ timeout: 1500 })
    const left = await page.evaluate(async () => {
      const api = window.DashboardHandoffTest
      return [(await api.recipientStore.list()).length, (await api.settlementStore.list()).length, (await api.senderStore.list()).length]
    })
    expect(left).toEqual([0, 0, 1])
    await open(page, '/offline/tickets')
    await offline(page)
    await page.evaluate(() => window.DashboardHandoffTest.mount())
    const row = page.getByRole('region', { name: 'Handoffs in progress' }).locator('li', { hasText: 'Fee preparation needs review' })
    await row.getByRole('link', { name: 'Fee preparation needs review' }).waitFor({ timeout: 1500 })
    await row.getByText('Needs internet', { exact: true }).waitFor()
    expect(network.requests()).toBe(0)
  } finally {
    await context.close()
  }
}, 15000)
