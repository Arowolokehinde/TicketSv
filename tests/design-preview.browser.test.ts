import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test('root opens the preserved Counterfoil landing and visual tokens', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfailed', request => errors.push(`Failed: ${request.url()}`))
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`)
  })
  await page.goto('/')
  await expect(page).toHaveURL(/\/design\/counterfoil-ui\.html#\/$/)
  await expect(page.locator('#lp .landing h1')).toContainText('The ticket')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wine').trim())).toBe('#722f2e')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acid').trim())).toBe('#dce68b')
  expect(await page.evaluate('typeof DEMO_SCREENS')).toBe('object')
  expect(await page.evaluate('S.length')).toBe(35)
  expect(errors).toEqual([])
})

test('built preview assets match their approved sources byte for byte', async ({ request }) => {
  for (const name of ['counterfoil-ui.html', 'counterfoil.css', 'counterfoil-demo.js']) {
    const response = await request.get(`/design/${name}`)
    expect(response.status()).toBe(200)
    expect(await response.body()).toEqual(await readFile(new URL(`../docs/superpowers/design/${name}`, import.meta.url)))
  }
})

test('workspace entry hashes survive reload and remain labelled as prototypes', async ({ page }) => {
  for (const route of ['/', '/tickets', '/venue', '/scanner']) {
    await page.goto(`/design/counterfoil-ui.html#${route}`)
    await page.reload()
    await expect(page.locator('#lp .proto-label')).toContainText('prototype')
    await expect(page.locator('#lp h1')).toBeVisible()
  }
  await page.goto('/#b1')
  await expect(page).toHaveURL(/\/design\/counterfoil-ui\.html#b1$/)
  await expect(page.locator('#lp h1')).toHaveText('Receive a ticket.')
})
