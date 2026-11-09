import { expect, test, type Page } from '@playwright/test'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import { syntheticSigningWallet } from './helpers/synthetic-signing-wallet.ts'


async function softwareWallet(page: Page, key = PrivateKey.fromRandom(), issue = false) {
  const wallet = new ProtoWallet(key), signing = issue ? syntheticSigningWallet() : undefined
  const calls: string[] = []
  await page.route('http://localhost:3321/**', async route => {
    const method = new URL(route.request().url()).pathname.slice(1)
    calls.push(method)
    const allowed = ['getPublicKey', 'createSignature', 'verifySignature', 'createHmac', 'verifyHmac']
    const args = route.request().postDataJSON()
    const result = method === 'getNetwork' ? { network: 'testnet' } : method === 'getVersion' ? { version: 'test-wallet-1.0' } : method === 'createAction' && signing ? await signing.createAction(args) : allowed.includes(method) ? await (wallet[method as keyof ProtoWallet] as Function).call(wallet, args) : { error: 'Forbidden wallet method' }
    await route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } })
  })
  return calls
}

test('landing login, organiser event save, reload, logout and direct URL protection', async ({ page }) => {
  const calls = await softwareWallet(page)
  await page.goto('/')
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(calls).toEqual([])
  await page.getByRole('button', { name: 'Connect and sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/tickets$/)
  await page.getByRole('link', { name: 'Create event', exact: true }).click()
  await expect(page).toHaveURL(/\/venue$/)
  await expect(page.getByRole('button', { name: 'Create event', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Create event', exact: true }).click()
  await page.getByLabel('Event name', { exact: true }).fill('Authenticated event')
  await page.getByLabel('Event date', { exact: true }).fill('2027-01-02')
  await page.getByLabel('Start time', { exact: true }).fill('18:00')
  await page.getByLabel('Venue name', { exact: true }).fill('The hall')
  await page.getByLabel('Venue address', { exact: true }).fill('1 Test Street')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.locator('.event-card')).toContainText('Authenticated event')
  const afterLogin = calls.length
  await page.reload()
  await expect(page.locator('.event-card')).toContainText('Authenticated event')
  expect(calls).toHaveLength(afterLogin)
  expect(calls).toContain('createSignature')
  expect(calls).not.toContain('createAction')
  expect(calls).not.toContain('internalizeAction')
  const cookie = (await page.context().cookies()).find(value => value.name === 'ticketsv_session')!
  expect(cookie.httpOnly).toBe(true)
  expect(cookie.sameSite).toBe('Strict')
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Connect your wallet to continue.' })).toBeVisible()
  await page.goto('/venue')
  await expect(page.getByRole('button', { name: 'Create event', exact: true })).toHaveCount(0)
  expect((await page.request.get('/api/events')).status()).toBe(401)
})

test('direct dashboard requires login and offline experiment is not gated', async ({ page }) => {
  const calls = await softwareWallet(page)
  await page.goto('/tickets')
  await expect(page.getByRole('heading', { name: 'Connect your wallet to continue.' })).toBeVisible()
  await page.goto('/dev/reopening')
  await expect(page.getByRole('heading', { name: 'Offline reopening experiment.' })).toBeVisible()
  expect(calls).toEqual([])
})

test('closing login before wallet returns cannot navigate or create a session', async ({ page }) => {
  await page.route('http://localhost:3321/**', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ json: { network: 'testnet' } }).catch(() => {}) })
  await page.goto('/')
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.getByRole('button', { name: 'Connect and sign in', exact: true }).click()
  await page.getByRole('button', { name: 'Close wallet panel' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect((await page.request.get('/api/auth/session')).status()).toBe(401)
  await expect(page).toHaveURL(/\/$/)
})

test('cancelling after the server commits revokes that attempt', async ({ page }) => {
  await softwareWallet(page)
  let reached!: () => void, release!: () => void
  const committed = new Promise<void>(resolve => { reached = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/auth/login', async route => {
    if (!route.request().headers()['x-bsv-auth-signature']) { await route.continue(); return }
    const response = await route.fetch()
    reached()
    await held
    await route.fulfill({ response }).catch(() => {})
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.getByRole('button', { name: 'Connect and sign in', exact: true }).click()
  await committed
  await page.getByRole('button', { name: 'Close wallet panel' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  release()
  expect((await page.request.get('/api/auth/session')).status()).toBe(401)
  await page.reload()
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})


test('two authenticated accounts publish, request, issue and receive through the real API', async ({ page, browser }) => {
  const organiserCalls = await softwareWallet(page, new PrivateKey(1), true)
  const buyerContext = await browser.newContext({ viewport: page.viewportSize()! })
  try {
    const buyerPage = await buyerContext.newPage()
    const buyerCalls = await softwareWallet(buyerPage, new PrivateKey(73))
    const name = `Attendee event ${crypto.randomUUID().slice(0, 8)}`
    await page.goto('/venue')
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await page.getByRole('button', { name: 'Connect and sign in', exact: true }).click()
    await page.getByRole('button', { name: 'Create event', exact: true }).click()
    await page.getByLabel('Event name', { exact: true }).fill(name)
    await page.getByLabel('Event date', { exact: true }).fill('2027-06-12')
    await page.getByLabel('Start time', { exact: true }).fill('19:30')
    await page.getByLabel('Venue name', { exact: true }).fill('Harbour Hall')
    await page.getByLabel('Venue address', { exact: true }).fill('14 Marina Road')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await page.getByRole('button', { name: `Manage publication for ${name}` }).click()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Publish event', exact: true }).click()
    const href = await page.getByRole('link', { name: /View public event/ }).getAttribute('href')
    await buyerPage.goto(`http://127.0.0.1:4175${href}`)
    await buyerPage.getByRole('button', { name: 'Request ticket', exact: true }).click()
    await buyerPage.getByRole('button', { name: 'Connect and sign in', exact: true }).click()
    await buyerPage.getByRole('checkbox').check()
    await buyerPage.getByRole('button', { name: 'Request ticket', exact: true }).click()
    await expect(buyerPage.getByText(/Request sent/)).toBeVisible()
    await page.getByRole('button', { name: 'Back to events', exact: true }).click()
    await page.getByRole('button', { name: `Tickets for ${name}` }).click()
    await page.getByRole('button', { name: 'Review new issuance', exact: true }).click()
    await expect(page.getByText('Attendee account', { exact: true })).toBeVisible()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Issue and broadcast ticket', exact: true }).click()
    await expect(page.getByText('Ticket evidence saved', { exact: true })).toBeVisible()
    expect(organiserCalls.filter(c => c === 'createAction')).toHaveLength(1)
    expect(buyerCalls).not.toContain('createAction')
    await buyerPage.goto('http://127.0.0.1:4175/tickets')
    const card = buyerPage.locator('.dashboard-tickets article').filter({ hasText: name })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'View ticket', exact: true }).click()
    await expect(buyerPage.getByRole('region', { name: 'Selected ticket' })).toContainText(name)
    await buyerPage.reload()
    await expect(buyerPage.locator('.dashboard-tickets article').filter({ hasText: name })).toBeVisible()
    expect(organiserCalls.filter(c => c === 'createAction')).toHaveLength(1)
    expect(await buyerPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  } finally { await buyerContext.close() }
})
