import { expect, test, type Page } from '@playwright/test'

const identityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
async function desktop(page: Page, network = 'testnet') {
  const calls: string[] = []
  await page.route('http://localhost:3321/**', async route => {
    const method = new URL(route.request().url()).pathname.slice(1)
    calls.push(method)
    const body = method === 'getNetwork' ? { network } : method === 'getVersion' ? { version: 'test-v1.0.0' } : method === 'getPublicKey' ? { publicKey: identityKey } : { unexpected: true }
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } })
  })
  return calls
}

test('connect explicitly reads desktop identity and network, without signing or persistence', async ({ page }) => {
  const calls = await desktop(page)
  await page.goto('/dev/feasibility')
  expect(calls).toEqual([])
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.getByText('Connection observed this session.', { exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="wallet-identity"]')).toHaveText(identityKey)
  expect(calls).toEqual(['getNetwork', 'getVersion', 'getPublicKey', 'getNetwork'])
  await expect(page.getByText('Not tested', { exact: true })).toHaveCount(7)
  await expect(page.locator('.wallet-call-log')).not.toContainText(identityKey)
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(identityKey)
  await page.getByRole('button', { name: 'Clear connection result' }).click()
  await expect(page.locator('[data-testid="wallet-identity"]')).toHaveCount(0)
  await page.reload()
  expect(calls).toHaveLength(4)
  await expect(page.getByText('Wallet: not connected', { exact: true })).toBeVisible()
})

test('wrong network is rejected before asking for identity', async ({ page }) => {
  const calls = await desktop(page, 'mainnet')
  await page.goto('/dev/feasibility')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not on testnet')
  expect(calls).toEqual(['getNetwork'])
  await expect(page.locator('[data-testid="wallet-identity"]')).toHaveCount(0)
})

test('unavailable wallet permits retry and native bridge absence is explicit', async ({ page }) => {
  await page.route('http://localhost:3321/**', route => route.abort())
  await page.goto('/dev/feasibility')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('failed or was declined')
  await page.unroute('http://localhost:3321/**')
  await desktop(page)
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.locator('[data-testid="wallet-identity"]')).toBeVisible()
  await page.getByRole('button', { name: 'Clear connection result' }).click()
  await page.getByLabel('Wallet connection method').selectOption('browser-native')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('native wallet bridge is unavailable')
})

test('cancelled native response cannot complete an old attempt', async ({ page }) => {
  await page.addInitScript(() => {
    const host = window as unknown as { ReactNativeWebView: { postMessage: (value: string) => void }; testMessages: string[] }
    host.testMessages = []
    host.ReactNativeWebView = { postMessage: value => host.testMessages.push(value) }
  })
  await page.goto('/dev/feasibility')
  await page.getByLabel('Wallet connection method').selectOption('browser-native')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await expect.poll(() => page.evaluate('window.testMessages.length')).toBe(1)
  await page.getByRole('button', { name: 'Cancel connection' }).click()
  await expect(page.getByRole('alert')).toContainText('cancelled')
  await page.evaluate(() => {
    const request = JSON.parse((window as unknown as { testMessages: string[] }).testMessages[0]!)
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'CWI', isInvocation: false, id: request.id, status: 'success', result: { network: 'testnet' } }) }))
  })
  await page.waitForTimeout(100)
  expect(await page.evaluate('window.testMessages.length')).toBe(1)
  await expect(page.locator('[data-testid="wallet-identity"]')).toHaveCount(0)
})

test('pending connection times out and can be retried', async ({ page }) => {
  await page.clock.install()
  await page.addInitScript(() => {
    Object.assign(window, { ReactNativeWebView: { postMessage: () => {} } })
  })
  await page.goto('/dev/feasibility')
  await page.getByLabel('Wallet connection method').selectOption('browser-native')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await page.clock.fastForward(30_100)
  await expect(page.getByRole('alert')).toContainText('within 30 seconds')
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeEnabled()
})

for (const action of ['cancel', 'timeout'] as const) {
  test(`${action} settles while the SDK chunk is still loading`, async ({ page }) => {
    await page.clock.install()
    const calls = await desktop(page)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    let requested = false
    await page.route('**/assets/wallet-*.js', async route => {
      requested = true
      await held
      await route.continue()
    })
    await page.goto('/dev/feasibility')
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await expect.poll(() => requested).toBe(true)
    try {
      if (action === 'cancel') await page.getByRole('button', { name: 'Cancel connection' }).click()
      else await page.clock.fastForward(30_100)
      await expect(page.getByRole('alert')).toContainText(action === 'cancel' ? 'cancelled' : 'within 30 seconds')
      await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeEnabled()
      expect(calls).toEqual([])
    } finally { release() }
    // A retry shares the previously stalled import; only the new attempt may call the wallet.
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await expect(page.getByTestId('wallet-identity')).toBeVisible()
    expect(calls).toEqual(['getNetwork', 'getVersion', 'getPublicKey', 'getNetwork'])
  })
}
