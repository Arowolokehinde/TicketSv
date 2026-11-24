import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { accountApi } from './helpers/account-api.ts'
declare global {
  interface Window {
    HeaderMiningTest: typeof import('./helpers/app-header-browser-entry.tsx')
    AttendeeMiningChecks: string[]
    AttendeeMiningFail: boolean
    AttendeeMiningVerified: boolean
    AttendeeAppReady: boolean
  }
}
let browser: Browser, bundle: string, styles: string
beforeAll(async () => {
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.VITE_SHARED_HEADERS': '"true"' },
    plugins: [
      {
        name: 'synthetic-preparation-boundary',
        transform(_code, id) {
          if (id.endsWith('/src/verification/verifyTicket.ts'))
            return `export async function verifyTicket(){return {verdict:window.AttendeeMiningVerified?'verified':'incomplete',checks:[],presentedTransferMined:!!window.AttendeeMiningVerified,anchorHeights:[]}}`
          if (id.endsWith('/src/offline/attendee-cache.ts'))
            return (
              "export async function prepareAttendeeApp(){return window.AttendeeAppReady?'ready':'waiting'};" +
              "export async function attendeeAppStatus(){return window.AttendeeAppReady?'ready':'waiting'};" +
              "export async function prepareCachedApp(){return 'ready'};export class OfflineAppUnavailableError extends Error{}"
            )
          if (id.endsWith('/src/events/verify-venue-ticket.ts'))
            return (
              "export async function verifyVenueTicket(pkg){window.AttendeeMiningChecks.push(pkg.atomicBeefBase64);if(window.AttendeeMiningFail)throw Error('Temporary header delay');" +
              "return {verdict:window.AttendeeMiningVerified?'verified':'incomplete',checks:[],presentedTransferMined:!!window.AttendeeMiningVerified,anchorHeights:[]}}"
            )
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/app-header-browser-entry.tsx'), name: 'HeaderMiningTest', formats: ['iife'] },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('Missing mining test bundle')
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
it('prepares after mining detection and retains the mined envelope when header preparation fails', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    f = await attendeeOfflineFixture()
  try {
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }))
    const auth = await accountApi(context)
    auth.setSession({ identityKey: f.identity, network: 'testnet', expiresAt: new Date(Date.now() + 3600000).toISOString() })
    const initial = structuredClone(f.record),
      proof = f.tx.merklePath!.toHex()
    f.tx.merklePath = undefined
    const { Utils } = await import('@bsv/sdk')
    initial.pkg!.atomicBeefBase64 = Utils.toBase64(f.tx.toAtomicBEEF())
    await context.route('**/api/tickets', route => route.fulfill({ json: { tickets: [initial], nextOffset: null } }))
    await context.route('**/api/tickets/requests', route => route.fulfill({ json: { requests: [], nextOffset: null } }))
    await context.route(
      url => url.pathname === `/api/tickets/${initial.id}`,
      route => route.fulfill({ json: initial }),
    )
    await context.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/tx/**', route =>
      route.fulfill({
        json: { txid: initial.txid, txStatus: 'MINED', blockHeight: 1762324, blockHash: '00'.repeat(32), merklePath: proof },
      }),
    )
    let walletCalls = 0
    await context.route(/localhost:(3321|2121)/, route => {
      walletCalls++
      return route.abort()
    })
    await page.goto('http://127.0.0.1:4175/tickets')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(() => {
      window.AttendeeMiningChecks = []
      window.AttendeeMiningFail = false
      window.HeaderMiningTest.mount()
    })
    await page.getByRole('button', { name: 'View ticket', exact: true }).click()
    expect(await page.getByRole('button', { name: 'Verify ticket', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Save for offline use', exact: true }).count()).toBe(0)
    expect(await page.getByRole('button', { name: 'Check wallet readiness', exact: true }).count()).toBe(0)
    await page.evaluate(() => {
      window.AttendeeMiningFail = true
    })
    await page.getByRole('button', { name: 'Check mining evidence', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Temporary header delay' }).waitFor({ timeout: 1500 })
    const calls = await page.evaluate(() => window.AttendeeMiningChecks)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(f.record.pkg!.atomicBeefBase64)
    await page.evaluate(() => {
      window.AttendeeMiningFail = false
    })
    await page.getByRole('button', { name: 'Verify ticket', exact: true }).click()
    await page.waitForFunction(() => window.AttendeeMiningChecks.length === 2)
    expect((await page.evaluate(() => window.AttendeeMiningChecks))[1]).toBe(f.record.pkg!.atomicBeefBase64)
    expect(walletCalls).toBe(0)
  } finally {
    await context.close()
  }
}, 15000)

it('reveals each next action only after success, retains retries, and resumes saved preparation on reopen and reload without wallet or provider calls', async () => {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }),
      page = await context.newPage(),
      f = await attendeeOfflineFixture()
    page.setDefaultTimeout(2500)
    let status = 'SEEN_MULTIPLE_NODES',
      walletCalls = 0,
      providerCalls = 0
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
      await context.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/tx/**', r => {
        providerCalls++
        return r.fulfill({
          json: {
            txid: f.record.txid,
            txStatus: status,
            blockHeight: 1762324,
            blockHash: '00'.repeat(32),
            merklePath: f.tx.merklePath!.toHex(),
          },
        })
      })
      await context.route(/localhost:(3321|2121)/, r => {
        walletCalls++
        return r.abort()
      })
      await page.goto('http://127.0.0.1:4175/tickets')
      await page.addStyleTag({ content: styles })
      await page.addScriptTag({ content: bundle })
      await page.evaluate(() => {
        window.AttendeeMiningChecks = []
        window.AttendeeMiningFail = false
        window.AttendeeMiningVerified = false
        window.AttendeeAppReady = false
        window.HeaderMiningTest.mount()
      })
      const button = (name: string) => page.getByRole('button', { name, exact: true })
      await button('View ticket').click()
      await page.getByRole('region', { name: 'Selected ticket', exact: true }).waitFor()
      await mkdir('.superpowers/sdd/attendee-steps', { recursive: true })
      await page
        .getByRole('region', { name: 'Selected ticket', exact: true })
        .screenshot({ path: `.superpowers/sdd/attendee-steps/mining-${width}.png` })
      await button('Check mining evidence').click()
      await page.getByText(/Mining proof is not available/).waitFor()
      expect(await button('Verify ticket').count()).toBe(0)
      status = 'MINED'
      await button('Check mining evidence').click()
      await button('Verify ticket').waitFor()
      await page.getByText(/Mining evidence loaded for this session/).waitFor()
      await button('Verify ticket').click()
      await page.getByRole('heading', { name: 'Ticket verification: incomplete' }).waitFor()
      expect(await button('Save for offline use').count()).toBe(0)
      await page.evaluate(() => {
        window.AttendeeMiningVerified = true
      })
      await button('Verify ticket').click()
      await button('Save for offline use').waitFor()
      expect(await button('Verify ticket').count()).toBe(0)
      expect(await button('Check wallet readiness').count()).toBe(0)
      await button('Save for offline use').click()
      await page.getByText('Offline app: update waiting', { exact: true }).waitFor()
      expect(await button('Check wallet readiness').count()).toBe(0)
      await page.evaluate(() => {
        window.AttendeeAppReady = true
      })
      await button('Save for offline use').click()
      await button('Check wallet readiness').waitFor()
      expect(await button('Save for offline use').count()).toBe(0)
      expect(await button('Add ticket to wallet').count()).toBe(0)
      expect(walletCalls).toBe(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.evaluate(
        async ({ record, owner }) => {
          const api = window.HeaderMiningTest,
            evidence = api.attendeeEvidence(record, owner, location.origin),
            r = await api.attendeeImportStore.claim(evidence)
          await api.attendeeImportStore.finish(evidence, r.attempt.id, 'accepted')
          await api.attendeeImportStore.observe(evidence, r.attempt.id, {
            state: 'present',
            reason: 'Synthetic matching wallet record',
            walletIdentity: owner,
            walletVersion: 'wallet-brc100-1.0.0',
            outpoint: `${record.pkg!.current.txid}.0`,
            requestId: record.request.requestId,
            snapshotId: 'aa'.repeat(32),
            checkedAt: new Date().toISOString(),
          })
        },
        { record: f.record, owner: f.identity },
      )
      const providerBefore = providerCalls
      await button('Close ticket').click()
      await button('View ticket').click()
      await page.getByText('PREPARATION COMPLETE', { exact: true }).waitFor()
      expect(await button('Check mining evidence').count()).toBe(0)
      expect(await button('Save for offline use').count()).toBe(0)
      expect(await page.getByText('Import response: accepted', { exact: true }).isVisible()).toBe(true)
      await page.reload()
      await page.addScriptTag({ content: bundle })
      await page.evaluate(() => {
        window.AttendeeMiningChecks = []
        window.AttendeeMiningVerified = true
        window.AttendeeMiningFail = false
        window.AttendeeAppReady = true
        window.HeaderMiningTest.mount()
      })
      await button('View ticket').click()
      await page.getByText('PREPARATION COMPLETE', { exact: true }).waitFor()
      expect(await page.getByText('Wallet record: present', { exact: true }).isVisible()).toBe(true)
      expect(await button('Add ticket to wallet').count()).toBe(0)
      expect(walletCalls).toBe(0)
      expect(providerCalls).toBe(providerBefore)
      // Evidence is checked again locally; missing data cannot restore an old verdict.
      await button('Close ticket').click()
      await page.evaluate(() => {
        window.AttendeeMiningVerified = false
      })
      await button('View ticket').click()
      await button('Verify ticket').waitFor()
      expect(await page.getByText('PREPARATION COMPLETE', { exact: true }).count()).toBe(0)
      expect(await button('Check mining evidence').count()).toBe(0)
    } finally {
      await context.close()
    }
  }
}, 15000)
