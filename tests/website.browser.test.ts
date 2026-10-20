import { expect, test } from '@playwright/test'

test('homepage is the native website with working journey and motion controls', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('#root h1')).toContainText('The ticket')
  await expect(page.locator('#index, #stagebar, .device, .proto-label, iframe')).toHaveCount(0)
  await page.getByRole('button', { name: 'Pause motion' }).click()
  await expect(page.getByRole('button', { name: 'Resume motion' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '02 Buyer' }).click()
  await expect(page.locator('.journey-description h3')).toHaveText('Check it. Save the package.')
  await page.getByRole('link', { name: /^Open my tickets/ }).first().click()
  await expect(page).toHaveURL(/\/tickets$/)
  await expect(page.getByRole('heading', { name: 'My tickets.', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.locator('#root h1')).toContainText('The ticket')
})

test('workspaces have separate navigation and survive direct reloads', async ({ page }) => {
  for (const [path, title, nav] of [
    ['/tickets', 'My tickets.', 'Ticket holder navigation'],
    ['/venue', 'Issue a ticket.', 'Venue navigation'],
    ['/scanner', 'Scan a ticket.', 'Scanner navigation'],
  ]) {
    await page.goto(path!)
    await page.reload()
    await expect(page.getByRole('heading', { name: title!, exact: true })).toBeVisible()
    const rail = page.getByRole('navigation', { name: nav! })
    await expect(rail).toBeVisible()
    if (path !== '/tickets') {
      await expect(rail.getByRole('link', { name: 'Receive ticket', exact: true })).toHaveCount(0)
    }
    await rail.getByRole('link', { name: 'Prepare offline', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path}/prepare$`))
    await expect(page.getByRole('heading', { name: 'Prepare for offline use.', exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: nav! })).toBeVisible()
  }
})

test('sample collection stays distinct from real acceptance and unsupported operations', async ({ page }) => {
  await page.goto('/tickets')
  await expect(page.getByText('Sample tickets — no real tickets saved.', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'View sample ticket & evidence' }).click()
  await expect(page.getByRole('heading', { name: 'Harbour Nights.', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByText('Sample evidence — not verified on this device.', { exact: true })).toBeVisible()
  await page.goto('/tickets')
  await page.getByRole('button', { name: 'Hide sample tickets' }).click()
  await expect(page.getByRole('heading', { name: 'No tickets saved yet.' })).toBeVisible()
  await page.getByRole('link', { name: 'Receive your first ticket' }).click()
  await expect(page.getByRole('button', { name: 'Create receiving request' })).toBeDisabled()
  await expect(page.getByText('No receiving request has been created.', { exact: true })).toBeVisible()
  await page.goto('/venue')
  await expect(page.getByRole('button', { name: 'Sign & issue ticket' })).toBeDisabled()
  await page.goto('/scanner')
  await expect(page.getByRole('button', { name: 'Start scanning' })).toBeDisabled()
})

test('product routes are responsive and make no external or wallet requests', async ({ page, baseURL }) => {
  const outside: string[] = []
  const errors: string[] = []
  const origin = new URL(baseURL!).origin
  page.on('request', request => { if (new URL(request.url()).origin !== origin) outside.push(request.url()) })
  page.on('websocket', socket => outside.push(socket.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const paths = ['/', '/tickets', '/tickets/receive', '/tickets/transfer', '/tickets/sample', '/venue', '/scanner']
  for (const root of ['/tickets', '/venue', '/scanner']) {
    for (const child of ['prepare', 'headers', 'activity']) paths.push(`${root}/${child}`)
  }
  for (const path of paths) {
    await page.goto(path)
    await expect(page.locator('#root h1')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Page not found.' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), path).toBe(false)
    await expect(page.locator('#index, #stagebar, .device, .proto-label, iframe')).toHaveCount(0)
  }
  expect(outside).toEqual([])
  expect(errors).toEqual([])
})

test('landing respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('#root .floating-ticket')).toBeVisible()
  expect(await page.locator('.floating-ticket').evaluate(element => getComputedStyle(element).animationName)).toBe('none')
})

test('landing makes its current integration boundary explicit', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Ticket handoff and offline verification are not available yet.', { exact: true })).toBeVisible()
  await page.locator('summary').filter({ hasText: 'Does accepting offline confirm the transfer?' }).click()
  await expect(page.getByText(/Local saving and offline reopening are not implemented in this version/)).toBeVisible()
})

test('trailing-slash routes retain navigation state and keyboard users can skip navigation', async ({ page }) => {
  await page.goto('/tickets/')
  await expect(page.getByRole('navigation', { name: 'Ticket holder navigation' }).getByRole('link', { name: 'My tickets', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main')).toBeFocused()
})
