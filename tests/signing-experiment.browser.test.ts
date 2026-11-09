import { expect, test } from '@playwright/test'
import { syntheticSigningWallet } from './helpers/synthetic-signing-wallet.ts'
import { prepareSigning } from '../src/wallet/signing-experiment.ts'

test('preserves a failed transfer error for download without retrying or signing', async ({ page }) => {
  const wallet = syntheticSigningWallet()
  const prepared = await prepareSigning(wallet, 'error-run')
  Object.assign(wallet, { listOutputs: async () => ({ totalOutputs: 1, outputs: [{ outpoint: `${prepared.source.txid}.${prepared.source.outputIndex}`, spendable: true, satoshis: 1 }] }) })
  const calls: string[] = []
  await page.route('http://localhost:3321/**', async route => {
    const method = new URL(route.request().url()).pathname.slice(1) as keyof typeof wallet
    calls.push(method)
    if (method === 'createAction') {
      await route.fulfill({ status: 400, json: { isError: true, code: 1, name: 'WERR_INTERNAL', message: 'Service unavailable <b>offline</b>', stack: 'private-stack-marker' } })
      return
    }
    const operation = wallet[method] as (args: unknown) => Promise<unknown>
    await route.fulfill({ json: await operation(route.request().postDataJSON()) })
  })
  await page.goto('/dev/feasibility')
  await page.getByLabel('Load saved preparation').setInputFiles({ name: 'preparation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(prepared)) })
  await expect(page.getByRole('button', { name: 'Download preparation' })).toBeVisible()
  await page.getByLabel('I have saved the preparation and isolated external networking for the app and wallet.').check()
  await page.getByRole('button', { name: 'Attempt transfer signing', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByText('Error details', { exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Service unavailable <b>offline</b>')
  await expect(page.getByRole('alert').locator('b')).toHaveCount(0)
  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download failure details' }).click()
  const downloaded = await pendingDownload
  const stream = await downloaded.createReadStream()
  const chunks = []
  for await (const chunk of stream!) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  const report = JSON.parse(text)
  expect(report.failure).toMatchObject({ phase: 'transfer', method: 'createAction', walletResponse: { status: 400, code: 1, message: 'Service unavailable <b>offline</b>' } })
  expect(text).not.toContain('private-stack-marker')
  expect(report).not.toHaveProperty('preparation')
  await expect(page.getByRole('button', { name: 'Attempt transfer signing', exact: true })).toBeDisabled()
  expect(calls.filter(method => method === 'createAction')).toHaveLength(1)
  expect(calls).not.toContain('createSignature')
  expect(calls).not.toContain('signAction')
})

test('loads saved preparation without another transaction and requires fresh offline acknowledgement', async ({ page }) => {
  const wallet = syntheticSigningWallet()
  const prepared = await prepareSigning(wallet, 'saved-run')
  Object.assign(wallet, { listOutputs: async () => ({ totalOutputs: 1, outputs: [{ outpoint: `${prepared.source.txid}.${prepared.source.outputIndex}`, spendable: true, satoshis: 1 }] }) })
  const calls: string[] = []
  await page.route('http://localhost:3321/**', async route => {
    const method = new URL(route.request().url()).pathname.slice(1) as keyof typeof wallet
    calls.push(method)
    const operation = wallet[method] as (args: unknown) => Promise<unknown>
    await route.fulfill({ json: await operation(route.request().postDataJSON()), headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto('/dev/feasibility')
  await page.getByLabel('Load saved preparation').setInputFiles({ name: 'preparation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(prepared)) })
  await expect(page.getByRole('button', { name: 'Download preparation' })).toBeVisible()
  expect(calls).not.toContain('createAction')
  expect(calls).not.toContain('createSignature')
  await expect(page.getByRole('button', { name: 'Attempt transfer signing', exact: true })).toBeDisabled()
})

test('exports complete synthetic signed evidence only after preparation and isolation acknowledgement', async ({ page }) => {
  const wallet = syntheticSigningWallet()
  const calls: string[] = []
  await page.route('http://localhost:3321/**', async route => {
    const method = new URL(route.request().url()).pathname.slice(1) as keyof typeof wallet
    calls.push(method)
    const operation = wallet[method] as (args: unknown) => Promise<unknown>
    const result = await operation(route.request().postDataJSON())
    await route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto('/dev/feasibility')
  await page.getByLabel('I have test funds and understand this reserves wallet inputs.').check()
  await page.getByRole('button', { name: 'Prepare signing fixture', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Download preparation' })).toBeVisible()
  const transfer = page.getByRole('button', { name: 'Attempt transfer signing', exact: true })
  await expect(transfer).toBeDisabled()
  const preparedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download preparation' }).click()
  expect((await preparedDownload).suggestedFilename()).toBe('counterfoil-signing-preparation.json')
  await expect(transfer).toBeDisabled()
  await page.getByLabel('I have saved the preparation and isolated external networking for the app and wallet.').check()
  // A prepared warm tab should need no additional app assets to perform signing.
  await page.route('**/assets/**', route => route.abort())
  await transfer.click()
  await expect(page.getByText('Final signed bytes returned; local script checks passed.', { exact: true })).toBeVisible()
  expect(calls.filter(method => method === 'createAction')).toHaveLength(2)
  expect(calls.filter(method => method === 'signAction')).toHaveLength(1)
  await expect(page.locator('.signing-panel')).toContainText('Chain anchors were not checked')
  await expect(page.getByText('Not tested', { exact: true })).toHaveCount(7)
  const finalDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download signing result' }).click()
  expect((await finalDownload).suggestedFilename()).toBe('counterfoil-signing-result.json')
})

test('signing experiment requires explicit acknowledgement and never starts on load', async ({ page }) => {
  const calls: string[] = []
  await page.route('http://localhost:3321/**', async route => {
    calls.push(new URL(route.request().url()).pathname)
    await route.fulfill({ json: { network: 'mainnet' }, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto('/dev/feasibility')
  await expect(page.getByRole('heading', { name: 'Offline signing experiment.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prepare signing fixture', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Attempt transfer signing', exact: true })).toHaveCount(0)
  expect(calls).toEqual([])
  await page.getByLabel('I have test funds and understand this reserves wallet inputs.').check()
  await page.getByRole('button', { name: 'Prepare signing fixture', exact: true }).click()
  await expect(page.locator('.signing-panel [role="alert"]')).toContainText('testnet')
  expect(calls).toEqual(['/getNetwork'])
  await expect(page.getByRole('button', { name: 'Prepare signing fixture', exact: true })).toBeDisabled()
  await expect(page.getByText('Not tested', { exact: true })).toHaveCount(7)
})

test('stalled initial wallet check stops the attempt and prevents automatic retry', async ({ page }) => {
  await page.clock.install()
  let count = 0
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('http://localhost:3321/**', async route => {
    count++
    await held
    await route.abort()
  })
  await page.goto('/dev/feasibility')
  await page.getByLabel('I have test funds and understand this reserves wallet inputs.').check()
  await page.getByRole('button', { name: 'Prepare signing fixture', exact: true }).click()
  await expect.poll(() => count).toBe(1)
  try {
    await page.clock.fastForward(60_100)
    await expect(page.locator('.signing-panel [role="alert"]')).toContainText('timed out')
    await expect(page.getByRole('button', { name: 'Prepare signing fixture', exact: true })).toBeDisabled()
    expect(count).toBe(1)
  } finally { release() }
})

for (const stalledMethod of ['createAction', 'signAction'] as const) {
  test(`lost ${stalledMethod} response preserves uncertainty and prevents repeat mutations`, async ({ page }) => {
    await page.clock.install()
    const wallet = syntheticSigningWallet()
    const calls: string[] = []
    let stalled = false
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('http://localhost:3321/**', async route => {
      const method = new URL(route.request().url()).pathname.slice(1) as keyof typeof wallet
      calls.push(method)
      const operation = wallet[method] as (args: unknown) => Promise<unknown>
      const result = await operation(route.request().postDataJSON())
      if (method === stalledMethod) { stalled = true; await held }
      await route.fulfill({ json: result, headers: { 'access-control-allow-origin': '*' } })
    })
    await page.goto('/dev/feasibility')
    await page.getByLabel('I have test funds and understand this reserves wallet inputs.').check()
    await page.getByRole('button', { name: 'Prepare signing fixture', exact: true }).click()
    if (stalledMethod === 'signAction') {
      await page.getByRole('button', { name: 'Download preparation' }).click()
      await page.getByLabel('I have saved the preparation and isolated external networking for the app and wallet.').check()
      await page.getByRole('button', { name: 'Attempt transfer signing', exact: true }).click()
    }
    await expect.poll(() => stalled).toBe(true)
    try {
      await page.clock.fastForward(60_100)
      await expect(page.locator('.signing-panel [role="alert"]')).toContainText('outcome may be unknown')
      await expect(page.getByRole('button', { name: 'Prepare signing fixture', exact: true })).toBeDisabled()
      if (stalledMethod === 'signAction') {
        await expect(page.getByRole('button', { name: 'Attempt transfer signing', exact: true })).toBeDisabled()
        await page.getByText('Wallet action references', { exact: true }).click()
        await expect(page.locator('.signing-panel')).toContainText('dGVzdA==')
      }
    } finally { release() }
    await page.waitForTimeout(100)
    expect(calls.filter(method => method === 'createAction')).toHaveLength(stalledMethod === 'createAction' ? 1 : 2)
    expect(calls.filter(method => method === 'signAction')).toHaveLength(stalledMethod === 'createAction' ? 0 : 1)
    await expect(page.getByRole('button', { name: 'Download signing result' })).toHaveCount(0)
  })
}
