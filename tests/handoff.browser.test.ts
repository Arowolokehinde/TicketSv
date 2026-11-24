import { expect, test, type Page } from '@playwright/test'
test('handoff opens without a server session or wallet calls and keeps actions explicit', async ({ page, context }) => {
  const contacts: string[] = []
  await context.route('**/api/**', r => {
    contacts.push(r.request().url())
    return r.abort()
  })
  await context.route('http://localhost:3321/**', r => {
    contacts.push(r.request().url())
    return r.abort()
  })
  await page.goto('/offline/handoff')
  await expect(page.getByRole('heading', { name: 'Transfer a ticket.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Receive ticket', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Receive ticket', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Choose invitation file', exact: true })).toBeVisible()
  expect(contacts).toEqual([])
  await expect(page.getByRole('button', { name: 'Create receiving request', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
// The app worker registers itself on any online visit; wait until it holds every file.
async function saved(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const r = await navigator.serviceWorker.getRegistration('/')
          if (!r?.active) return false
          return new Promise<boolean>(resolve => {
            const ch = new MessageChannel()
            ch.port1.onmessage = e => {
              ch.port1.close()
              resolve(e.data?.ready === true)
            }
            r.active!.postMessage('CHECK_APP_CACHE', [ch.port2])
          })
        }),
      { timeout: 20000 },
    )
    .toBe(true)
}
test('production handoff route reopens from the offline worker without sign-in', async ({ page, context }) => {
  await page.goto('/offline/handoff')
  await saved(page)
  await page.reload()
  await context.setOffline(true)
  await page.close()
  const reopened = await context.newPage(),
    contacts: string[] = []
  context.on('request', r => {
    if (r.url().includes('/api/') || r.url().includes(':3321')) contacts.push(r.url())
  })
  await reopened.goto('/offline/handoff')
  await expect(reopened.getByRole('heading', { name: 'Transfer a ticket.' })).toBeVisible()
  await reopened.getByRole('link', { name: 'Receive ticket', exact: true }).click()
  await expect(reopened.getByRole('button', { name: 'Choose invitation file', exact: true })).toBeVisible()
  expect(contacts).toEqual([])
})
test('a page reloaded offline lands on On this device, and /api is never answered from the saved app', async ({ page, context }) => {
  await page.goto('/tickets')
  await saved(page)
  await context.setOffline(true)
  await page.reload()
  await expect(page).toHaveURL(/\/offline\/tickets$/)
  await expect(page.getByRole('heading', { name: /^On this device/ })).toBeVisible()
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('/api/auth/session')
        return 'answered'
      } catch {
        return 'network error'
      }
    }),
  ).toBe('network error')
  await page.goto('/scanner')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})
