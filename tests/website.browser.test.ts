import { expect, test } from '@playwright/test'
import { accountApi } from './helpers/account-api.ts'
test.beforeEach(async ({ context }) => { await accountApi(context) })

test('homepage is the native website with working journey and navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('#root h1')).toContainText('Your next event.')
  await expect(page.locator('#index, #stagebar, .device, .proto-label, iframe')).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Ticket handoff steps' })).toBeVisible()
  await expect(page.locator('.motion-row')).toBeHidden()
  const hero = page.locator('.hero-object')
  const originalBounds = await hero.boundingBox()
  await page.locator('.motion-row').evaluate(element => { element.style.visibility = 'visible' })
  expect(await hero.boundingBox()).toEqual(originalBounds)
  await page.locator('.motion-row').evaluate(element => { element.style.removeProperty('visibility') })
  await page.getByRole('link', { name: /^Open dashboard/ }).first().click()
  await expect(page).toHaveURL(/\/tickets$/)
  await expect(page.getByRole('heading', { name: 'Good times. Great memories.', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.locator('#root h1')).toContainText('Your next event.')
})

test('workspaces have separate navigation and survive direct reloads', async ({ page }) => {
  for (const [path, title, nav] of [
    ['/tickets', 'Good times. Great memories.', 'Ticket holder navigation'],
    ['/venue', 'Create event', 'Ticket holder navigation'],
    ['/venue/my-events', 'My events', 'Ticket holder navigation'],
    // The scanner's two tabs opened the same page, so it has no rail.
    ['/scanner', 'Scan a ticket.', 'Scanner navigation'],
  ]) {
    await page.goto(path!)
    await page.reload()
    await expect(page.getByRole('heading', { name: title!, exact: true })).toBeVisible()
    const rail = page.getByRole('navigation', { name: nav! })
    if (path === '/scanner') {
      await expect(rail).toHaveCount(0)
      continue
    }
    await expect(rail).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Prepare offline', exact: true })).toHaveCount(0)
  }
})

test('removed placeholder pages send old links to the real flows', async ({ page }) => {
  for (const [from, to] of [['/tickets/sample', /\/tickets$/], ['/tickets/receive', /\/offline\/handoff\?step=receive$/], ['/tickets/transfer', /\/offline\/handoff\?step=prepare$/], ['/tickets/prepare', /\/tickets$/], ['/venue/prepare', /\/venue$/]] as const) {
    await page.goto(from)
    await expect(page).toHaveURL(to)
  }
})

test('product routes are responsive and make no external or wallet requests', async ({ page, baseURL }) => {
  const outside: string[] = []
  const errors: string[] = []
  const origin = new URL(baseURL!).origin
  page.on('request', request => { if (new URL(request.url()).origin !== origin) outside.push(request.url()) })
  page.on('websocket', socket => outside.push(socket.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.fallback() : route.abort())
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

test('landing FAQ explains the current saving and confirmation boundary', async ({ page }) => {
  await page.goto('/')
  await page.locator('summary').filter({ hasText: 'Does accepting offline confirm the transfer?' }).click()
  await expect(page.getByText(/Saving and offline reopening are not connected to the main website yet/)).toBeVisible()
})

test('trailing-slash routes retain navigation state and keyboard users can skip navigation', async ({ page }) => {
  await page.goto('/tickets/')
  await expect(page.getByRole('navigation', { name: 'Ticket holder navigation' }).getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main')).toBeFocused()
})

test('handoff shows all steps with animation and reduced-motion support', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await page.getByRole('link', { name: 'See how it works' }).click()
  const steps = page.getByRole('list', { name: 'Ticket handoff steps' })
  for (const name of ['Prepare', 'Transfer', 'Verify']) {
    await expect(steps.getByRole('heading', { name, exact: true })).toBeVisible()
  }
  await expect(page.locator('.handoff-story')).toHaveClass(/is-visible/)
  const illustration = page.locator('.handoff-pass')
  expect(await illustration.evaluate(element => getComputedStyle(element).animationName)).toBe('handoff-pass')
  expect(await illustration.evaluate(element => getComputedStyle(element).animationIterationCount)).toBe('infinite')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await illustration.evaluate(element => getComputedStyle(element).animationName)).toBe('none')
})

test('landing header stays visible on scroll and section links leave headings uncovered', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const header = page.locator('.app-header')
  await page.evaluate(() => window.scrollTo(0, 900))
  await expect.poll(async () => (await header.boundingBox())!.y).toBe(0)
  for (const id of ['how', 'evidence', 'faq']) {
    await page.evaluate(id => { location.hash = id }, id)
    await expect(page).toHaveURL(new RegExp(`#${id}$`))
    const heading = await page.locator(`#${id} > .section-label`).boundingBox()
    const box = await header.boundingBox()
    expect(heading!.y).toBeGreaterThanOrEqual(box!.y + box!.height)
    expect(box!.y).toBe(0)
  }
  await header.getByRole('link', { name: /^Dashboard/ }).click()
  await expect(page).toHaveURL(/\/tickets$/)
})
