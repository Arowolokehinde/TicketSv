import { expect, test } from '@playwright/test'

test('harness is honest, reloadable and inert without a wallet installed', async ({ page, baseURL }) => {
  const outsideApp: string[] = []
  const sockets: string[] = []
  const errors: string[] = []
  const origin = new URL(baseURL!).origin
  page.on('request', request => {
    if (new URL(request.url()).origin !== origin) outsideApp.push(request.url())
  })
  page.on('websocket', socket => sockets.push(socket.url()))
  page.on('pageerror', error => errors.push(error.message))
  // Fail closed if a future startup hook tries to contact any remote or local wallet service.
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())

  for (let load = 0; load < 2; load++) {
    if (load === 0) await page.goto('/dev/feasibility')
    else await page.reload()
    await expect(page.getByRole('heading', { name: 'Development harness' })).toBeVisible()
    await expect(page.getByText('Testnet', { exact: true })).toBeVisible()
    await expect(page.getByText('Wallet: not connected', { exact: true })).toBeVisible()
    await expect(page.getByText('Not tested', { exact: true })).toHaveCount(7)
    await expect(page.getByText(/^(Passed|Connected|Ready offline)$/)).toHaveCount(0)
    await expect(page.getByRole('button')).toHaveCount(0)
    await page.waitForTimeout(1000)
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
    expect(await page.evaluate(() => ['wallet', 'WalletClient', 'bsv', 'bsvWallet'].filter(key => key in window))).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
  }
  expect(outsideApp).toEqual([])
  expect(sockets).toEqual([])
  expect(errors).toEqual([])
})

test('unknown paths recover to the actual website', async ({ page }) => {
  await page.goto('/not-a-page')
  await expect(page.getByRole('heading', { name: 'Page not found.' })).toBeVisible()
  await page.getByRole('link', { name: 'Back to home' }).click()
  await expect(page.locator('#root .landing h1')).toContainText('The ticket')
  await expect(page).toHaveURL(/\/$/)
})
