import { afterAll, beforeAll, expect, it } from 'vitest'
import { expect as see } from '@playwright/test'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
import { accountApi } from './helpers/account-api.ts'
declare global {
  interface Window {
    DashboardHandoffTest: typeof import('./helpers/dashboard-handoff-browser-entry.tsx')
  }
}
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
  if (!('output' in result)) throw Error('Missing dashboard test bundle')
  bundle = result.output
    .filter(p => p.type === 'chunk')
    .map(p => p.code)
    .join('\n')
  browser = await chromium.launch({ headless: true })
}, 20000)
afterAll(async () => {
  await browser?.close()
})
const owner = '02' + '11'.repeat(32),
  loading = 'Loading or checking your evidence…'
// The ticket list can be held open or failed on demand, to see what a slow or failed refresh does.
async function setup(context: BrowserContext) {
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="root"></div>' }))
  const auth = await accountApi(context)
  auth.setSession({ identityKey: owner, network: 'testnet', expiresAt: new Date(Date.now() + 3600000).toISOString() })
  let lists = 0,
    hold: Promise<void> | undefined,
    fail = false
  await context.route('**/api/tickets/received**', route => route.fulfill({ json: { tickets: [], nextOffset: null } }))
  await context.route('**/api/tickets/requests', route => route.fulfill({ json: { requests: [], nextOffset: null } }))
  await context.route('**/api/tickets', async route => {
    lists++
    if (hold) await hold
    await route.fulfill(fail ? { status: 500, json: { error: 'Unavailable' } } : { json: { tickets: [], nextOffset: null } })
  })
  return {
    lists: () => lists,
    hold: (gate?: Promise<void>) => {
      hold = gate
    },
    fail: (value: boolean) => {
      fail = value
    },
  }
}
async function open(page: Page) {
  await page.goto('http://127.0.0.1:4175/tickets')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(() => window.DashboardHandoffTest.mount())
  await page.getByText('YOUR TICKETS', { exact: true }).waitFor()
  await page.getByRole('heading', { name: /^Your collection/ }).waitFor()
  // Loads are silent; the first one has finished when the Refresh icon stops turning.
  await expect.poll(() => page.locator('.dashboard-refresh .is-refreshing').count()).toBe(0)
  expect(await page.getByText(loading).count()).toBe(0)
}
it('refreshes quietly when the browser comes back online and never blocks the person', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    api = await setup(context)
  try {
    await open(page)
    const before = api.lists()
    let release!: () => void
    api.hold(
      new Promise<void>(resolve => {
        release = resolve
      }),
    )
    await page.evaluate(() => dispatchEvent(new Event('online')))
    await expect.poll(() => api.lists()).toBe(before + 1)
    // A slow background refresh shows no status, keeps controls enabled, and gives way to the person's own action.
    expect(await page.getByText(loading).count()).toBe(0)
    const refresh = page.getByRole('button', { name: 'Refresh dashboard', exact: true })
    expect(await refresh.isEnabled()).toBe(true)
    // Refresh replaces the quiet refresh with a fresh load, still without a status line.
    await refresh.click()
    await expect.poll(() => api.lists()).toBe(before + 2)
    expect(await page.getByText(loading).count()).toBe(0)
    release()
    api.hold(undefined)
    expect(await page.getByRole('alert').count()).toBe(0)
  } finally {
    await context.close()
  }
}, 20000)
it('does not reload every time the window regains focus', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    api = await setup(context)
  try {
    await open(page)
    const before = api.lists()
    for (let i = 0; i < 3; i++) await page.evaluate(() => dispatchEvent(new Event('focus')))
    await page.waitForTimeout(500)
    expect(api.lists()).toBe(before)
    expect(await page.getByText(loading).count()).toBe(0)
  } finally {
    await context.close()
  }
}, 20000)
it('a failed background refresh keeps what is shown and says so briefly', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    api = await setup(context)
  try {
    await open(page)
    api.fail(true)
    await page.evaluate(() => dispatchEvent(new Event('online')))
    await page.getByText('Could not refresh. Showing the last loaded tickets.').waitFor()
    expect(await page.getByRole('alert').count()).toBe(0)
    await page.getByRole('heading', { name: /^Your collection/ }).waitFor()
  } finally {
    await context.close()
  }
}, 20000)
it('the first load and Refresh show no status line; only the Refresh icon turns', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    api = await setup(context)
  try {
    let release!: () => void
    api.hold(
      new Promise<void>(resolve => {
        release = resolve
      }),
    )
    await page.goto('http://127.0.0.1:4175/tickets')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(() => window.DashboardHandoffTest.mount())
    await page.getByText('YOUR TICKETS', { exact: true }).waitFor()
    await expect.poll(() => api.lists()).toBe(1)
    expect(await page.getByText(loading).count()).toBe(0)
    expect(await page.locator('.dashboard-refresh .is-refreshing').count()).toBe(1)
    release()
    api.hold(undefined)
    await expect.poll(() => page.locator('.dashboard-refresh .is-refreshing').count()).toBe(0)
    const before = api.lists()
    await page.getByRole('button', { name: 'Refresh dashboard', exact: true }).click()
    await expect.poll(() => api.lists()).toBe(before + 1)
    expect(await page.getByText(loading).count()).toBe(0)
  } finally {
    await context.close()
  }
}, 20000)
it('a failed first load still explains the problem', async () => {
  const context = await browser.newContext(),
    page = await context.newPage(),
    api = await setup(context)
  try {
    api.fail(true)
    await page.goto('http://127.0.0.1:4175/tickets')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(() => window.DashboardHandoffTest.mount())
    await see(page.getByRole('alert')).toContainText('Unavailable')
    expect(await page.getByText(loading).count()).toBe(0)
  } finally {
    await context.close()
  }
}, 20000)
