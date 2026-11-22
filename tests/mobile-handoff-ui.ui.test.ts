import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { handoffFixture } from './helpers/handoff-fixture.ts'
import { invitationFor } from '../src/handoff/evidence.ts'
import { makeSnapshot, parseProviderHeader } from '../src/headers/validate.ts'
import header from './fixtures/headers/woc-1762324.json' with { type: 'json' }
declare global {
  interface Window {
    MobileHandoffTest: typeof import('./helpers/dashboard-handoff-browser-entry.tsx')
  }
}
let browser: Browser, bundle: string
beforeAll(async () => {
  const built = await build({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.PROD': 'true' },
    build: {
      write: false,
      minify: false,
      lib: { entry: resolve('tests/helpers/dashboard-handoff-browser-entry.tsx'), name: 'MobileHandoffTest', formats: ['iife'] },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('Missing bundle')
  bundle = result.output
    .filter(p => p.type === 'chunk')
    .map(p => p.code)
    .join('\n')
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
})
it('preserves receiving online in a native browser without falsely reporting offline app readiness', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    f = await handoffFixture(true),
    invitation = invitationFor(f.source, 1762324)
  let walletCalls = 0
  page.setDefaultTimeout(2500)
  try {
    await context.route('**/*', r => r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await context.route('**/api/marketplace/events/**', r =>
      r.fulfill({ json: { ...invitation.event, id: invitation.eventId, revision: 1, venueIdentity: invitation.trustedVenue } }),
    )
    await context.route(/localhost:(3321|2121)/, r => {
      walletCalls++
      return r.abort()
    })
    await page.goto('http://127.0.0.1:4175/offline/handoff?step=receive')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(
      async snapshot => {
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
        Object.assign(window, {
          ReactNativeWebView: {
            postMessage: () => {
              throw Error('Unexpected native wallet call')
            },
          },
        })
        await window.MobileHandoffTest.saveSnapshot(snapshot)
        window.MobileHandoffTest.mount()
      },
      makeSnapshot([parseProviderHeader(header, 'whatsonchain', header.height)]),
    )
    await page
      .getByLabel('Load invitation file', { exact: true })
      .setInputFiles({ name: 'invitation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invitation)) })
    await page.getByRole('checkbox', { name: /I reviewed this published event/ }).check()
    await page.getByRole('button', { name: 'Save organiser review', exact: true }).click()
    await page.getByRole('checkbox', { name: /I authorize receiving-key and identity signatures/ }).check()
    await page.getByRole('button', { name: 'Prepare this device online', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'cannot reopen TicketSV offline' }).waitFor()
    expect(await page.getByRole('alert').count()).toBe(0)
    expect(await page.getByText('Device files and headers saved.', { exact: false }).count()).toBe(0)
    await page.getByRole('checkbox', { name: /I authorize receiving-key and identity signatures/ }).check()
    expect(await page.getByRole('button', { name: 'Create receiving request', exact: true }).isEnabled()).toBe(true)
    await page.getByText('Wallet connection', { exact: true }).click()
    expect(await page.getByRole('combobox', { name: /Connection method/ }).inputValue()).toBe('browser-native')
    expect(walletCalls).toBe(0)
  } finally {
    await context.close()
  }
}, 10000)

it('restores the selected signed transfer and Send step after reload without wallet or API requests', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    f = await handoffFixture()
  let contacts = 0
  page.setDefaultTimeout(2000)
  await context.route('**/*', r => {
    if (r.request().isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
    contacts++
    return r.abort()
  })
  try {
    await page.goto('http://127.0.0.1:4175/offline/handoff?step=prepare')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(
      async f => {
        Object.defineProperty(navigator, 'onLine', { get: () => false })
        const t = f.source,
          id = `${t.holder}:testnet:${t.pkg.current.txid}.${t.pkg.current.index}`
        await window.MobileHandoffTest.senderStore.save(
          { kind: 'ticketsv-handoff-sender', version: 1, id, revision: 0, ticket: t, request: f.request, transfer: f.ticket },
          undefined,
        )
        await window.MobileHandoffTest.settlementStore.save(
          { id: `${f.ticket.holder}:testnet:${f.ticket.pkg.current.txid}`, revision: 0, version: 1, ticket: f.ticket },
          undefined,
        )
        window.MobileHandoffTest.mount()
      },
      { source: f.source, request: f.request, ticket: f.ticket },
    )
    await page
      .getByLabel('Choose handoff ticket', { exact: true })
      .selectOption({ label: `${f.source.event.name} · ${f.source.pkg.current.txid.slice(0, 12)}` })
    expect(await page.getByLabel('Choose handoff ticket', { exact: true }).locator('option').allTextContents()).toEqual([
      'Choose a ticket',
      `${f.source.event.name} · ${f.source.pkg.current.txid.slice(0, 12)}`,
    ])
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await page.getByRole('heading', { name: 'Transfer signed and saved', exact: true }).waitFor()
    await page.reload()
    await page.addScriptTag({ content: bundle })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false })
      window.MobileHandoffTest.mount()
    })
    await page.getByRole('heading', { name: 'Transfer signed and saved', exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Send', exact: true }).getAttribute('aria-current')).toBe('step')
    expect(await page.getByRole('button', { name: 'Save ticket file', exact: true }).count()).toBe(1)
    expect(await page.getByLabel('Choose handoff ticket', { exact: true }).locator('option').count()).toBe(2)
    await page.getByRole('button', { name: 'Continue to confirmation', exact: true }).click()
    expect(await page.getByLabel('Saved transfer', { exact: true }).inputValue()).toBe(
      `${f.ticket.holder}:testnet:${f.ticket.pkg.current.txid}`,
    )
    expect(contacts).toBe(0)
  } finally {
    await context.close()
  }
}, 10000)

it('restores the independent receiving request and ticket after reopening without making verification claims', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    f = await handoffFixture()
  let contacts = 0
  page.setDefaultTimeout(2000)
  await context.route('**/*', r => {
    if (r.request().isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
    contacts++
    return r.abort()
  })
  try {
    await page.goto('http://127.0.0.1:4175/offline/handoff?step=receive')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(
      async f => {
        Object.defineProperty(navigator, 'onLine', { get: () => false })
        const id = `${f.request.recipientIdentity}:${f.request.request.requestId}`
        await window.MobileHandoffTest.recipientStore.save(
          { kind: 'ticketsv-handoff-recipient', version: 1, id, revision: 0, request: f.request, ticket: f.ticket },
          undefined,
        )
        window.MobileHandoffTest.mount()
      },
      { request: f.request, ticket: f.ticket },
    )
    const id = `${f.request.recipientIdentity}:${f.request.request.requestId}`
    await page.getByLabel('Saved receiving request', { exact: true }).selectOption(id)
    await page.getByRole('button', { name: 'Verify locally', exact: true }).waitFor()
    await page.reload()
    await page.addScriptTag({ content: bundle })
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { get: () => false })
      window.MobileHandoffTest.mount()
    })
    await page.getByRole('button', { name: 'Verify locally', exact: true }).waitFor()
    expect(await page.getByLabel('Saved receiving request', { exact: true }).inputValue()).toBe(id)
    expect(await page.getByRole('heading', { name: 'Ticket evidence: verified', exact: true }).count()).toBe(0)
    expect(contacts).toBe(0)
  } finally {
    await context.close()
  }
}, 10000)

it.each(['present', 'absent', 'inconclusive'] as const)(
  'restores Receive with a saved %s wallet record without repeating completed steps',
  async state => {
    const context = await browser.newContext(),
      page = await context.newPage(),
      f = await handoffFixture(true),
      other = await handoffFixture()
    let contacts = 0
    page.setDefaultTimeout(2000)
    await context.route('**/*', r => {
      if (r.request().isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' })
      contacts++
      return r.abort()
    })
    try {
      await page.goto('http://127.0.0.1:4175/offline/handoff?step=receive')
      await page.addScriptTag({ content: bundle })
      await page.evaluate(
        async ({ request, ticket, state, otherRequest }) => {
          Object.defineProperty(navigator, 'onLine', { get: () => false })
          const id = `${request.recipientIdentity}:${request.request.requestId}`,
            now = new Date().toISOString()
          await window.MobileHandoffTest.recipientStore.save(
            { kind: 'ticketsv-handoff-recipient', version: 1, id, revision: 0, request, ticket },
            undefined,
          )
          await window.MobileHandoffTest.settlementStore.save(
            {
              id: `${ticket.holder}:testnet:${ticket.pkg.current.txid}`,
              revision: 0,
              version: 1,
              ticket,
              import: { id: 'import-test', startedAt: now, finishedAt: now, outcome: 'complete' },
              wallet: { state, checkedAt: now, reason: 'Saved wallet observation.' },
            },
            undefined,
          )
          await window.MobileHandoffTest.recipientStore.save(
            {
              kind: 'ticketsv-handoff-recipient',
              version: 1,
              id: `${otherRequest.recipientIdentity}:${otherRequest.request.requestId}`,
              revision: 0,
              request: otherRequest,
            },
            undefined,
          )
          window.MobileHandoffTest.mount()
        },
        { request: f.request, ticket: f.ticket, state, otherRequest: other.request },
      )
      await page
        .getByLabel('Saved receiving request', { exact: true })
        .selectOption(`${f.request.recipientIdentity}:${f.request.request.requestId}`)
      await page.reload()
      await page.addScriptTag({ content: bundle })
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { get: () => false })
        window.MobileHandoffTest.mount()
      })
      if (state === 'present') {
        await page.getByRole('heading', { name: 'Ticket recorded in your wallet.', exact: true }).waitFor()
        expect(await page.getByRole('button', { name: 'Continue to confirmation', exact: true }).count()).toBe(0)
        expect(await page.getByRole('button', { name: 'Verify locally', exact: true }).count()).toBe(0)
        await page
          .getByLabel('Saved receiving request', { exact: true })
          .selectOption(`${other.request.recipientIdentity}:${other.request.request.requestId}`)
        await page.getByRole('heading', { name: 'Your request is saved', exact: true }).waitFor()
        expect(await page.getByRole('heading', { name: 'Ticket recorded in your wallet.', exact: true }).count()).toBe(0)
        await page
          .getByLabel('Saved receiving request', { exact: true })
          .selectOption(`${f.request.recipientIdentity}:${f.request.request.requestId}`)
        await page.getByText('Review received ticket', { exact: true }).click()
        expect(await page.getByRole('button', { name: 'Recheck saved evidence', exact: true }).isEnabled()).toBe(true)
        await page.getByRole('button', { name: 'View confirmation', exact: true }).click()
        expect(await page.getByLabel('Saved transfer', { exact: true }).inputValue()).toBe(
          `${f.ticket.holder}:testnet:${f.ticket.pkg.current.txid}`,
        )
        expect(await page.getByRole('button', { name: 'Add received ticket to wallet', exact: true }).count()).toBe(0)
      } else {
        await page.getByRole('button', { name: 'Verify locally', exact: true }).waitFor()
        expect(await page.getByRole('heading', { name: 'Ticket recorded in your wallet.', exact: true }).count()).toBe(0)
      }
      expect(contacts).toBe(0)
    } finally {
      await context.close()
    }
  },
  10000,
)
