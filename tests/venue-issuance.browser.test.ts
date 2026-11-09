import { test, expect } from '@playwright/test'
import { accountApi } from './helpers/account-api.ts'

for (const status of ['prepared', 'pending', 'complete'] as const) {
 test(`Venue shows ${status} issuance safely on reload`, async ({ page, context }) => {
  const fixture = await accountApi(context)
  const id = 'b54a41c1-e532-42d4-8f86-04f91c547d73', ticketId = '4dfe41f8-9716-4974-999b-79fb6a840d5d'
  const event = { id, name: 'Harbour Nights', description: '', date: '2027-06-12', time: '19:30', timezone: 'Africa/Lagos', venue: 'Harbour Hall', address: '14 Marina Road', image: null, revision: 1, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  fixture.records.set(id, event)
  const record = { id: ticketId, eventId: id, owner: '02' + '11'.repeat(32), eventRevision: 1, event, status, txid: null, pkg: null, request: { requestId: `${ticketId}-source`, recipient: { publicKey: '03' + '22'.repeat(32) } }, createdAt: event.createdAt, updatedAt: event.updatedAt }
  let mutations = 0, walletCalls = 0
  await context.route('**/api/events/*/issuances**', route => {
   if (route.request().method() !== 'GET') mutations++
   return route.fulfill({ json: { issuances: [record] } })
  })
  await context.route('http://localhost:3321/**', route => { walletCalls++; return route.abort() })
  await page.goto('/venue')
  await page.getByRole('button', { name: 'Tickets for Harbour Nights' }).click()
  await expect(page.getByRole('heading', { name: 'Issue a ticket' })).toBeVisible()
  if (status === 'prepared') await expect(page.getByRole('button', { name: 'Issue and broadcast ticket', exact: true })).toBeDisabled()
  if (status === 'pending') { await expect(page.getByText('This attempt needs review before another ticket can be issued.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Issue and broadcast ticket', exact: true })).toHaveCount(0) }
  await page.reload()
  await page.getByRole('button', { name: 'Tickets for Harbour Nights' }).click()
  await expect(page.getByText(ticketId, { exact: true })).toBeVisible()
  expect(mutations).toBe(0); expect(walletCalls).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
 })
}

test('issues once after consent, recovers a failed evidence save after reload without another transaction', async ({ page, context }, testInfo) => {
 const { syntheticSigningWallet } = await import('./helpers/synthetic-signing-wallet.ts')
 const wallet = syntheticSigningWallet(), owner = (await wallet.getPublicKey({ identityKey: true })).publicKey
 const fixture = await accountApi(context)
 fixture.setSession({ identityKey: owner, network: 'testnet', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
 const id = 'b54a41c1-e532-42d4-8f86-04f91c547d73'
 const event = { id, name: 'Harbour Nights', description: '', date: '2027-06-12', time: '19:30', timezone: 'Africa/Lagos', venue: 'Harbour Hall', address: '14 Marina Road', image: null, revision: 1, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
 fixture.records.set(id, event)
 let record: any, failSave = true, creations = 0
 await context.route('http://localhost:3321/**', async route => {
  const method = new URL(route.request().url()).pathname.slice(1) as keyof typeof wallet
  if (method === 'createAction') creations++
  const operation = wallet[method] as (args: unknown) => Promise<unknown>
  await route.fulfill({ json: await operation(route.request().postDataJSON()) })
 })
 await context.route('**/api/events/*/issuances**', async route => {
  const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON()
  if (route.request().method() === 'GET') return route.fulfill({ json: { issuances: record ? [record] : [] } })
  if (path.endsWith('/issuances')) record = { id: body.ticketId, eventId: id, event, owner, eventRevision: 1, request: body.request, status: 'prepared', pkg: null, txid: null, createdAt: event.createdAt, updatedAt: event.updatedAt }
  if (path.endsWith('/start')) { if (record.status !== 'prepared') return route.fulfill({ status: 409, json: { error: 'Already started' } }); record.status = 'pending' }
  if (path.endsWith('/reference')) record.txid = body.txid
  if (path.endsWith('/evidence')) {
   if (failSave) return route.fulfill({ status: 503, json: { error: 'Evidence save unavailable' } })
   record.pkg = body.pkg; record.status = 'complete'
  }
  return route.fulfill({ json: record })
 })
 await page.goto('/venue'); await page.getByRole('button', { name: 'Tickets for Harbour Nights' }).click()
 await page.getByRole('button', { name: /Review new ticket/ }).click()
 const issue = page.getByRole('button', { name: 'Issue and broadcast ticket', exact: true })
 await expect(issue).toBeDisabled()
 expect(creations).toBe(0)
 await page.screenshot({ path: testInfo.outputPath('issuance-review.png'), fullPage: true })
 await page.getByRole('checkbox').check(); await issue.click()
 await expect(page.getByRole('alert')).toContainText('Evidence save unavailable')
 expect(creations).toBe(1)
 await page.reload(); await page.getByRole('button', { name: 'Tickets for Harbour Nights' }).click()
 failSave = false
 await page.getByRole('button', { name: 'Save existing evidence again' }).click()
 await expect(page.getByText('Ticket evidence saved', { exact: true })).toBeVisible()
 await expect(page.getByRole('button', { name: 'Save existing evidence again' })).toHaveCount(0)
 expect(creations).toBe(1)
 await expect(page.getByRole('button', { name: 'Issue and broadcast ticket', exact: true })).toHaveCount(0)
})

// Header responses are recorded fixtures; these tests never contact a real wallet or provider.
async function verificationPage(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
 const { ticketFixture } = await import('./helpers/ticket-fixture.ts')
 const { Utils } = await import('@bsv/sdk')
 const f = await ticketFixture()
 f.issue.inputs[0].sourceTransaction!.merklePath!.blockHeight = 1762325
 f.pkg.atomicBeefBase64 = Utils.toBase64(f.transfer.toAtomicBEEF())
 const api = await accountApi(context)
 api.setSession({ identityKey: f.identity, network: 'testnet', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
 const event = { id: 'b54a41c1-e532-42d4-8f86-04f91c547d73', name: 'Header test', description: '', date: '2027-06-12', time: '19:30', timezone: 'Africa/Lagos', venue: 'Test Hall', address: '14 Marina Road', image: null, revision: 1, status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
 api.records.set(event.id, event)
 await context.route('**/api/events/*/issuances**', route => route.fulfill({ json: { issuances: [{ id: '4dfe41f8-9716-4974-999b-79fb6a840d5d', eventId: event.id, owner: f.identity, eventRevision: 1, event, status: 'complete', txid: f.pkg.current.txid, pkg: f.pkg, request: f.destination }] } }))
 const walletCalls: string[] = [], headerCalls: string[] = []
 await context.route('http://localhost:3321/**', route => { walletCalls.push(route.request().url()); return route.abort() })
 const { parseProviderHeader } = await import('../src/headers/validate.ts')
 const { CHECKPOINT } = await import('../src/headers/checkpoint.ts')
 const fixtures = await Promise.all([
  import('./fixtures/headers/woc-1762324.json', { with: { type: 'json' } }), import('./fixtures/headers/woc-1762325.json', { with: { type: 'json' } }),
 ])
 const bytes = Buffer.from(fixtures.map(f => parseProviderHeader(f.default, 'whatsonchain', f.default.height).hex).join(''), 'hex')
 await context.route('**/api/tickets/header-preparation', route => { headerCalls.push(route.request().url()); return route.fulfill({ json: { network:'testnet', checkpoint:CHECKPOINT, tip:1762325, state:'ready' } }) })
 await context.route('**/api/headers/range?**', route => { headerCalls.push(route.request().url()); return route.fulfill({ body:bytes, headers:{'X-TicketSV-Header-Start':'1762324','X-TicketSV-Header-Count':'2','X-TicketSV-Header-Network':'testnet','X-TicketSV-Header-Checkpoint':CHECKPOINT.hash,'X-TicketSV-Header-Comparison':'server-reported'} }) })
 await context.route('https://**', route => route.abort())
 await page.goto('/venue'); await page.getByRole('button', { name: 'Tickets for Header test' }).click()
 return { walletCalls, headerCalls }
}
test('Venue prepares missing headers in place, rechecks the proof, and reuses persisted headers', async ({ page, context }) => {
 const calls = await verificationPage(page, context)
 expect(calls.headerCalls).toHaveLength(0)
 await page.getByRole('button', { name: 'Verify ticket', exact: true }).click()
 // The synthetic ticket has an invented root. A completed download must not falsely verify it.
 await expect(page.getByRole('heading', { name: 'Ticket verification: rejected' })).toBeVisible()
 await expect(page.getByText(/anchors: fail.*Merkle proof/)).toBeVisible()
 expect(calls.headerCalls).toHaveLength(2); expect(calls.walletCalls).toHaveLength(0)
 await expect(page.locator('.venue-issuance a[href="/dev/feasibility"]')).toHaveCount(0)
 await page.reload(); await page.getByRole('button', { name: 'Tickets for Header test' }).click()
 await page.getByRole('button', { name: 'Verify ticket', exact: true }).click()
 await expect(page.getByRole('heading', { name: 'Ticket verification: rejected' })).toBeVisible()
 expect(calls.headerCalls).toHaveLength(2); expect(calls.walletCalls).toHaveLength(0)
})
test('Venue cancels header preparation without a verdict or wallet operation', async ({ page, context }) => {
 const calls = await verificationPage(page, context)
 let release!: () => void, started = false
 const held = new Promise<void>(resolve => { release = resolve })
 await context.route('**/api/headers/range?**', async route => { started = true; await held; await route.abort().catch(() => {}) })
 try {
  await page.getByRole('button', { name: 'Verify ticket', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  await page.getByRole('button', { name: 'Cancel verification' }).click()
  await expect(page.getByRole('alert')).toContainText('cancelled')
  await expect(page.getByRole('button', { name: 'Verify ticket', exact: true })).toBeEnabled()
  await expect(page.getByRole('heading', { name: /Ticket verification:/ })).toHaveCount(0)
  expect(calls.walletCalls).toHaveLength(0)
 } finally { release() }
})
