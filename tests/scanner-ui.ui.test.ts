import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
declare global {
  interface Window {
    ScannerTest: typeof import('./helpers/scanner-browser-entry.tsx')
  }
}
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
      lib: { entry: resolve('tests/helpers/scanner-browser-entry.tsx'), name: 'ScannerTest', formats: ['iife'] },
    },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!('output' in result)) throw Error('Missing scanner bundle')
  bundle = result.output
    .filter(p => p.type === 'chunk')
    .map(p => p.code)
    .join('\n')
  styles = result.output.flatMap(p => (p.type === 'asset' && p.fileName.endsWith('.css') ? [String(p.source)] : [])).join('\n')
  browser = await chromium.launch({ headless: true })
}, 30000)
afterAll(async () => {
  await browser?.close()
})
async function pageFor(context: BrowserContext, seed = true) {
  const calls: string[] = []
  await context.route('**/*', route => {
    if (route.request().isNavigationRequest())
      return route.fulfill({ contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>' })
    calls.push(route.request().url())
    return route.abort()
  })
  const page = await context.newPage()
  await page.goto('https://scanner.example/scanner')
  await page.addStyleTag({ content: styles })
  await page.addScriptTag({ content: bundle })
  const pkg = seed ? await page.evaluate(() => window.ScannerTest.seed()) : undefined
  await page.evaluate(() => window.ScannerTest.mount())
  await page.getByRole('heading', { name: seed ? 'This scanner' : 'Prepare this scanner', exact: true }).waitFor()
  return { page, calls, pkg }
}
it('imports and rejects fake evidence locally and clears old results on another import', async () => {
  const context = await browser.newContext()
  const { page, calls, pkg } = await pageFor(context)
  const upload = async (value: unknown) =>
    page
      .getByLabel('Load ticket file', { exact: true })
      .setInputFiles({ name: 'synthetic-ticket.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
  await upload(pkg)
  await page.getByRole('button', { name: 'Verify locally', exact: true }).click()
  await page.getByRole('heading', { name: 'Verification incomplete', exact: true }).waitFor()
  const bad = structuredClone(pkg!)
  bad.issuance.ticketId = 'tampered'
  await upload(bad)
  expect(await page.locator('.scanner-result').count()).toBe(0)
  await page.getByRole('button', { name: 'Verify locally', exact: true }).click()
  await page.getByRole('heading', { name: 'Ticket rejected', exact: true }).waitFor()
  expect(await page.locator('.scanner-result').innerText()).toContain('issuer: fail')
  expect(calls).toEqual([])
  await context.close()
})
it('restores evidence but recomputes verdicts, and fits narrow screens', async () => {
  const context = await browser.newContext({ viewport: { width: 320, height: 850 } })
  const { page, pkg, calls } = await pageFor(context)
  await page
    .getByLabel('Load ticket file', { exact: true })
    .setInputFiles({ name: 'ticket.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pkg)) })
  await page.getByRole('button', { name: 'Verify locally', exact: true }).click()
  await page.locator('.scanner-result').waitFor()
  await page.evaluate(() => {
    window.ScannerTest.unmount()
    window.ScannerTest.mount()
  })
  await page.getByRole('button', { name: 'Verify locally', exact: true }).waitFor()
  expect(await page.locator('.scanner-result').count()).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await mkdir('.superpowers/sdd/scanner', { recursive: true })
  await page.screenshot({ path: '.superpowers/sdd/scanner/phone.png', fullPage: true })
  expect(calls).toEqual([])
  await context.close()
})
it('requires event setup and reports camera denial without requesting a wallet', async () => {
  let context = await browser.newContext()
  let state = await pageFor(context, false)
  // Before preparation only step 1 has controls: no disabled scanning, no tabs that change nothing.
  await state.page.getByRole('heading', { level: 1, name: 'Scan a ticket.', exact: true }).waitFor()
  await state.page.getByText('STEP 1 · WHILE ONLINE', { exact: true }).waitFor()
  await state.page.getByText('Check tickets here once this scanner is prepared.', { exact: true }).waitFor()
  expect(await state.page.getByRole('button', { name: 'Scan ticket QR', exact: true }).count()).toBe(0)
  expect(await state.page.getByLabel('Load ticket file', { exact: true }).count()).toBe(0)
  expect(await state.page.getByRole('navigation', { name: 'Scanner navigation' }).count()).toBe(0)
  await context.close()
  context = await browser.newContext()
  state = await pageFor(context)
  // Once prepared, checking comes first and scanning is the main action.
  const order = await state.page.evaluate(() => {
    const check = document.querySelector('.scanner-check')!,
      setup = document.querySelector('.scanner-setup')!
    return !!(check.compareDocumentPosition(setup) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(order).toBe(true)
  await state.page.getByText('STEP 2 · AT THE DOOR', { exact: true }).waitFor()
  await state.page.getByText('Load a ticket file instead', { exact: true }).waitFor()
  await state.page.evaluate(() =>
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          throw new Error('Camera permission denied')
        },
      },
    }),
  )
  await state.page.getByRole('button', { name: 'Scan ticket QR', exact: true }).click()
  await state.page.getByRole('alert').filter({ hasText: 'Camera permission denied' }).waitFor()
  expect(state.calls).toEqual([])
  await context.close()
})
// The double-sale fixture with its mined block: the issuance and branch A are
// mined, so the issuance copy is a stale mined ticket once A spends it.
async function doorFixture() {
  const { readFileSync } = await import('node:fs'),
    { MerklePath, Utils } = await import('@bsv/sdk'),
    { conflictFixture } = await import('./helpers/conflict-fixture.ts'),
    { minedCandidate } = await import('../src/settlement/evidence.ts')
  const { makeSnapshot, parseProviderHeader } = await import('../src/headers/validate.ts'),
    checkpoint = (await import('./fixtures/headers/woc-1762324.json', { with: { type: 'json' } })).default
  const block = JSON.parse(readFileSync('tests/fixtures/conflict/mined-block.json', 'utf8'))
  const f = await conflictFixture()
  f.issuance.merklePath = MerklePath.fromHex(block.issuancePath)
  const branchA = await f.branch(f.a, 1)
  const a = minedCandidate(branchA, {
      txid: block.winnerTxid,
      txStatus: 'MINED',
      observedAt: '2026-11-18T00:00:00.000Z',
      blockHeight: block.header.height,
      blockHash: block.header.hash,
      merklePath: block.winnerPath,
    }).pkg,
    b = (await f.branch(f.b, 2)).pkg
  const stale = { ...f.base, atomicBeefBase64: Utils.toBase64(f.issuance.toAtomicBEEF()) }
  const snapshot = makeSnapshot(
    [parseProviderHeader(checkpoint, 'whatsonchain', checkpoint.height), block.header],
    '2026-11-18T00:00:00.000Z',
  )
  const event = {
    id: 'conflict-event',
    revision: 1,
    venueIdentity: f.trusted,
    name: 'Door event',
    date: '2030-01-01',
    time: '18:00',
    timezone: 'UTC',
    venue: 'Test hall',
    address: 'Test address',
    description: '',
  }
  const origin = `${f.issuance.id('hex')}.0`,
    list = { id: 'conflict-event', revision: 0, checkedAt: '2026-11-19T18:40:00.000Z', tickets: [origin], spent: [origin] }
  return {
    a,
    b,
    stale,
    snapshot: JSON.parse(JSON.stringify(snapshot)),
    event,
    list,
    origin,
    aHex: branchA.pkg.lineageRawTxs.at(-1)!,
    aTxid: branchA.pkg.current.txid,
  }
}
async function doorPage(context: BrowserContext, seed: { event: unknown; snapshot: unknown; list?: unknown }) {
  const { page, calls } = await pageFor(context, false)
  await page.evaluate(() => window.ScannerTest.unmount())
  await page.evaluate(({ event, snapshot, list }) => window.ScannerTest.seedDoor(event as never, snapshot, list as never), seed)
  await page.evaluate(() => window.ScannerTest.mount())
  await page
    .getByRole('heading', { name: 'This scanner', exact: true })
    .waitFor({ timeout: 8000 })
    .catch(async e => {
      throw Error(e.message + '\nUI: ' + (await page.locator('body').innerText()).slice(0, 800))
    })
  const seen = async (locator: ReturnType<typeof page.getByText>) =>
    locator.waitFor({ timeout: 8000 }).catch(async e => {
      throw Error(e.message + '\nUI: ' + (await page.locator('body').innerText()).slice(0, 1500))
    })
  const check = async (value: unknown) => {
    await page
      .getByLabel('Load ticket file', { exact: true })
      .setInputFiles({ name: 'ticket.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })
    await page.getByRole('button', { name: 'Verify locally', exact: true }).click()
  }
  return { page, calls, seen, check }
}
const TRANSFERRED = 'Not admitted: this ticket has been transferred to someone else.'
const UNCHECKED = "Not admitted: this door can't check whether the ticket was transferred. Reconnect or refresh preparation."
it('admits only a mined, unspent copy, refuses an unmined or second copy, and remembers it after a reload', async () => {
  const d = await doorFixture(),
    context = await browser.newContext()
  try {
    const { page, calls, seen, check } = await doorPage(context, d)
    await context.setOffline(true)
    await check(d.b)
    await seen(page.getByRole('heading', { name: 'Online check required', exact: true }))
    await seen(page.getByText("This transfer isn't mined yet, so it can't be admitted.", { exact: false }))
    await seen(page.getByText('Not admitted', { exact: true }))
    expect(await page.getByRole('button', { name: 'Admit', exact: true }).count()).toBe(0)
    await check(d.a)
    await seen(page.getByRole('heading', { name: 'Passes POC door policy', exact: true }))
    await seen(page.getByText(/^Ticket evidence: \d+\.\d KB · 1 transaction · 1 mining proof$/))
    await seen(page.getByText(/^Spend check: saved list from \d\d:\d\d$/))
    // The decision is read first, above the result details.
    expect(
      await page.evaluate(
        () =>
          !!(
            document.querySelector('.scanner-door')!.compareDocumentPosition(document.querySelector('.scanner-result')!) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
      ),
    ).toBe(true)
    await page.getByRole('button', { name: 'Admit', exact: true }).click()
    await seen(page.locator('.scanner-door').getByText('Admitted', { exact: true }))
    await check(d.b)
    await page.getByText(/^Already admitted at this door at \d\d:\d\d$/).waitFor()
    await page.getByText('This is a different copy of the same ticket. It may have been sold twice.', { exact: true }).waitFor()
    expect(await page.getByRole('button', { name: 'Admit', exact: true }).count()).toBe(0)
    await page.evaluate(() => {
      window.ScannerTest.unmount()
      window.ScannerTest.mount()
    })
    const list = page.getByRole('region', { name: 'Admitted at this door', exact: true })
    await list.waitFor()
    await list.getByText('Admitted', { exact: true }).waitFor()
    await list.getByText('1 other copy refused', { exact: true }).waitFor()
    expect(calls).toEqual([])
  } finally {
    await context.close()
  }
}, 30000)
it("offline, refuses a seller's earlier mined copy that the saved list shows was passed on", async () => {
  const d = await doorFixture(),
    context = await browser.newContext()
  try {
    const { page, calls, seen, check } = await doorPage(context, d)
    await context.setOffline(true)
    await seen(page.getByText(/^Checked \d\d:\d\d, 1 ticket$/))
    await check(d.stale)
    await seen(page.getByRole('heading', { name: 'Passes POC door policy', exact: true }))
    await seen(page.getByText(TRANSFERRED, { exact: true }))
    expect(await page.getByRole('button', { name: 'Admit', exact: true }).count()).toBe(0)
    expect(calls).toEqual([])
  } finally {
    await context.close()
  }
}, 30000)
it('offline, without a saved list, refuses a ticket it cannot check', async () => {
  const d = await doorFixture(),
    context = await browser.newContext()
  try {
    const { page, calls, seen, check } = await doorPage(context, { event: d.event, snapshot: d.snapshot })
    await context.setOffline(true)
    await seen(page.getByText('Not saved (organiser only)', { exact: true }))
    await check(d.a)
    await seen(page.getByText('Spend check: not available', { exact: true }))
    await seen(page.getByText(UNCHECKED, { exact: true }))
    expect(await page.getByRole('button', { name: 'Admit', exact: true }).count()).toBe(0)
    expect(calls).toEqual([])
  } finally {
    await context.close()
  }
}, 30000)
it('online, checks live that the ticket is unspent, even without a saved list', async () => {
  const d = await doorFixture(),
    context = await browser.newContext(),
    woc: string[] = []
  try {
    const { page, seen, check } = await doorPage(context, { event: d.event, snapshot: d.snapshot })
    await context.route('https://api.whatsonchain.com/**', route => {
      const url = route.request().url()
      woc.push(url)
      if (url.endsWith(`/tx/${d.origin.replace('.', '/')}/spent`))
        return route.fulfill({ json: { txid: d.aTxid, vin: 0, status: 'unconfirmed' } })
      if (url.endsWith(`/tx/${d.aTxid}/hex`)) return route.fulfill({ body: d.aHex })
      return route.fulfill({ status: 404, body: 'Not Found' })
    })
    await check(d.stale)
    await seen(page.getByText('Spend check: live, spent', { exact: true }))
    await seen(page.getByText(TRANSFERRED, { exact: true }))
    await check(d.a)
    await seen(page.getByText('Spend check: live, not spent', { exact: true }))
    await page.getByRole('button', { name: 'Admit', exact: true }).click()
    await seen(page.locator('.scanner-door').getByText('Admitted', { exact: true }))
    expect(woc.some(url => url.endsWith(`/tx/${d.aTxid}/0/spent`))).toBe(true)
  } finally {
    await context.close()
  }
}, 30000)
