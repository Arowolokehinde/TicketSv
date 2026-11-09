import { expect, test, type Page } from '@playwright/test'
import { accountApi } from './helpers/account-api.ts'
test.beforeEach(async ({ context }) => { await accountApi(context, false) })

const identity = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
async function wallet(page: Page, network = 'testnet', endpoint = 'http://localhost:3321') {
  const calls: string[] = []
  await page.route(`${endpoint}/**`, async route => {
    const method = new URL(route.request().url()).pathname.slice(1)
    calls.push(method)
    const body = method === 'getNetwork' ? { network } : method === 'getVersion' ? { version: 'test-v1.0.0' } : { publicKey: identity }
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } })
  })
  return calls
}

test('protected workspace explains sign-in and makes no automatic wallet calls', async ({ page }) => {
  const calls = await wallet(page)
  await page.goto('/tickets')
  await expect(page.getByRole('heading', { name: 'Connect your wallet to continue.' })).toBeVisible()
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('approve a sign-in signature')
  expect(calls).toEqual([])
  await page.getByRole('button', { name: 'Close wallet panel' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible()
  expect(calls).toEqual([])
})

test('wrong network stays disconnected and can be retried', async ({ page }) => {
  const calls = await wallet(page, 'mainnet')
  await page.goto('/venue')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await page.getByRole('button', { name: 'Connect and sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not on testnet')
  expect(calls).toEqual(['getNetwork'])
  await expect(page.getByRole('button', { name: 'Connect and sign in', exact: true })).toBeEnabled()

})

test('closing a pending connection ignores late responses and restores focus', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { testMessages: [], ReactNativeWebView: { postMessage: (value: string) => (window as unknown as { testMessages: string[] }).testMessages.push(value) } })
  })
  await page.goto('/scanner')
  const trigger = page.getByRole('button', { name: 'Connect wallet', exact: true })
  await trigger.click()
  await page.getByRole('radio', { name: 'BSV Browser', exact: true }).check()
  await page.getByRole('button', { name: 'Connect and sign in', exact: true }).click()
  await expect.poll(() => page.evaluate('window.testMessages.length')).toBe(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(trigger).toBeFocused()
  await page.evaluate(() => {
    const request = JSON.parse((window as unknown as { testMessages: string[] }).testMessages[0]!)
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'CWI', isInvocation: false, id: request.id, status: 'success', result: { network: 'testnet' } }) }))
  })
  await trigger.click()
  await expect(page.getByRole('button', { name: 'Connect and sign in', exact: true })).toBeEnabled()
  await expect(page.getByText(identity, { exact: true })).toHaveCount(0)
})


test('wallet choices hide transport details and keep HTTPS an explicit desktop setting', async ({ page }) => {
  const httpCalls = await wallet(page)
  const httpsCalls = await wallet(page, 'mainnet', 'https://localhost:2121')
  await page.goto('/tickets')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('radio')).toHaveCount(2)
  await expect(dialog.getByRole('radio', { name: 'BSV Desktop', exact: true })).toBeChecked()
  await expect(dialog.getByLabel('Desktop connection')).not.toBeVisible()
  await dialog.getByText('Advanced settings', { exact: true }).click()
  await dialog.getByLabel('Desktop connection').selectOption('desktop-https')
  await dialog.getByRole('radio', { name: 'BSV Browser', exact: true }).check()
  await expect(dialog.getByText('Advanced settings', { exact: true })).toHaveCount(0)
  await dialog.getByRole('radio', { name: 'BSV Desktop', exact: true }).check()
  await dialog.getByText('Advanced settings', { exact: true }).click()
  await expect(dialog.getByLabel('Desktop connection')).toHaveValue('desktop-https')
  expect(httpCalls).toEqual([])
  expect(httpsCalls).toEqual([])
  await dialog.getByRole('button', { name: 'Connect and sign in', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('not on testnet')
  expect(httpCalls).toEqual([])
  expect(httpsCalls).toEqual(['getNetwork'])
})

test('switching accounts clears the previous organiser editor', async ({ page, context }) => {
  const fixture = await accountApi(context)
  await page.goto('/venue')
  await page.getByRole('button', { name: 'Create event', exact: true }).click()
  await page.getByLabel('Event name', { exact: true }).fill('Private unsaved draft')
  fixture.setSession({ identityKey: '03' + '22'.repeat(32), network: 'testnet', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByLabel('Event name', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create event', exact: true })).toBeVisible()
  await expect(page.getByText('Private unsaved draft')).toHaveCount(0)
})

test('late session 401 cannot clear a newer authenticated refresh', async ({ page, context }) => {
  await accountApi(context)
  await page.goto('/venue')
  await expect(page.getByRole('button', { name: 'Create event', exact: true })).toBeVisible()
  let release!: () => void, started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const pending = new Promise<void>(resolve => { started = resolve })
  let first = true
  await page.route('**/api/auth/session', async route => {
    if (!first) { await route.fallback(); return }
    first = false; started(); await held
    await route.fulfill({ status: 401, json: { error: 'Expired earlier session' } })
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await pending
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/auth/session') && response.status() === 200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await refreshed
  release()
  await expect(page.getByRole('button', { name: 'Create event', exact: true })).toBeVisible()
})

test('an expired event request invalidates an older pending session response', async ({ page, context }) => {
  await accountApi(context)
  await page.goto('/venue')
  await page.getByRole('button', { name: 'Create event', exact: true }).click()
  let release!: () => void, started!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const pending = new Promise<void>(resolve => { started = resolve })
  await page.route('**/api/auth/session', async route => {
    started(); await held
    await route.fulfill({ json: { identityKey: '02' + '11'.repeat(32), network: 'testnet', expiresAt: new Date(Date.now() + 3600_000).toISOString() } })
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await pending
  await page.route('**/api/events', route => route.fulfill({ status: 401, json: { error: 'Session expired' } }))
  await page.getByLabel('Event name', { exact: true }).fill('Draft')
  await page.getByLabel('Event date', { exact: true }).fill('2027-01-02')
  await page.getByLabel('Start time', { exact: true }).fill('18:00')
  await page.getByLabel('Venue name', { exact: true }).fill('Hall')
  await page.getByLabel('Venue address', { exact: true }).fill('Street')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Connect your wallet to continue.' })).toBeVisible()
  const completed = page.waitForResponse(response => response.url().endsWith('/api/auth/session'))
  release(); await completed
  await expect(page.getByRole('button', { name: 'Create event', exact: true })).toHaveCount(0)
})
