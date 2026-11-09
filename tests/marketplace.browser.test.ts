import { test, expect } from '@playwright/test'
import { accountApi } from './helpers/account-api.ts'
import { ProtoWallet, PrivateKey, type WalletInterface } from '@bsv/sdk'
const id = 'b54a41c1-e532-42d4-8f86-04f91c547d73'
const event = { id, name: 'Harbour Nights', description: 'An evening by the water.', date: '2027-06-12', time: '19:30', timezone: 'Africa/Lagos', venue: 'Harbour Hall', address: '14 Marina Road', revision: 1, venueIdentity: new PrivateKey(1).toPublicKey().toString() }

test('public discovery keeps request behind sign-in and makes no wallet calls', async ({ page, context }) => {
 const auth = await accountApi(context); auth.setSession(null)
 let calls = 0
 await context.route('http://localhost:3321/**', route => { calls++; return route.abort() })
 await context.route('**/api/marketplace/events**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith(id) ? event : { events: [event], nextOffset: null } }))
 await page.goto('/events')
 await page.getByRole('link', { name: /Explore Harbour Nights/ }).click()
 await expect(page.getByRole('heading', { name: event.name })).toBeVisible()
 await page.getByRole('button', { name: 'Request ticket', exact: true }).click()
 await expect(page.getByRole('dialog')).toBeVisible()
 expect(calls).toBe(0)
 expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('attendee explicitly signs a receiving request and sees it after reload', async ({ page, context }) => {
 const auth = await accountApi(context), wallet = new ProtoWallet(new PrivateKey(73)) as WalletInterface
 wallet.getNetwork = async () => ({ network: 'testnet' })
 const owner = (await wallet.getPublicKey({ identityKey: true })).publicKey
 auth.setSession({ identityKey: owner, network: 'testnet', expiresAt: new Date(Date.now() + 3600_000).toISOString() })
 let saved: any, signatures = 0
 await context.route('**/api/marketplace/events/**', route => route.fulfill({ json: event }))
 await context.route('http://localhost:3321/**', async route => {
  const method = new URL(route.request().url()).pathname.slice(1)
  if (method === 'createSignature') signatures++
  if (!['getPublicKey', 'getNetwork', 'createSignature'].includes(method)) throw Error('Unexpected wallet mutation')
  await route.fulfill({ json: await (wallet[method as keyof WalletInterface] as Function).call(wallet, route.request().postDataJSON()) })
 })
 await context.route('**/api/tickets/requests**', async route => {
  if (route.request().method() === 'POST') {
   const { proof } = route.request().postDataJSON()
   saved = { id: proof.request.requestId, eventId: id, event, proof, status: 'requested', ticketId: null, createdAt: new Date().toISOString() }
   return route.fulfill({ status: 201, json: saved })
  }
  return route.fulfill({ json: { requests: saved ? [saved] : [], nextOffset: null } })
 })
 await context.route('**/api/tickets', route => route.fulfill({ json: { tickets: [], nextOffset: null } }))
 await page.goto(`/events/${id}`)
 await expect(page.getByRole('button', { name: 'Request ticket', exact: true })).toBeDisabled()
 await page.getByRole('checkbox').check()
 await page.getByRole('button', { name: 'Request ticket', exact: true }).click()
 await expect(page.getByText(/Request sent/)).toBeVisible()
 expect(signatures).toBe(1)
 await page.goto('/tickets')
 await expect(page.getByText('Waiting for organiser approval', { exact: true })).toBeVisible()
 await page.reload()
 await expect(page.getByText('Waiting for organiser approval', { exact: true })).toBeVisible()
 expect(signatures).toBe(1)
 expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})

test('Venue publishes only after review and displays attendee requests separately', async ({ page, context }) => {
 const auth = await accountApi(context)
 auth.records.set(id, { ...event, status: 'draft', image: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
 let published = false, posts = 0
 await context.route('**/api/events/*/publication', route => {
  if (route.request().method() === 'POST') { posts++; published = route.request().postDataJSON().published }
  return route.fulfill({ json: { published, revision: published ? 1 : null } })
 })
 await context.route('**/api/events/*/requests**', route => route.fulfill({ json: { requests: [], nextOffset: null } }))
 await page.goto('/venue')
 await page.getByRole('button', { name: 'Manage publication for Harbour Nights' }).click()
 expect(posts).toBe(0)
 await expect(page.getByRole('button', { name: 'Publish event', exact: true })).toBeDisabled()
 await page.getByRole('checkbox').check()
 await page.getByRole('button', { name: 'Publish event', exact: true }).click()
 await expect(page.getByText('Published on Events', { exact: true })).toBeVisible()
 expect(posts).toBe(1)
})

test('cancelling a native receiving request returns control before the wallet responds', async ({ page, context }) => {
 await accountApi(context)
 await context.addInitScript(() => {
  sessionStorage.setItem('ticketsv-wallet-transport', 'browser-native')
  Object.assign(window, { testMessages: [], ReactNativeWebView: { postMessage: (value: string) => (window as unknown as { testMessages: string[] }).testMessages.push(value) } })
 })
 await context.route('**/api/marketplace/events/**', route => route.fulfill({ json: event }))
 let posted = 0
 await context.route('**/api/tickets/requests**', route => { if (route.request().method() === 'POST') posted++; return route.fulfill({ json: { requests: [], nextOffset: null } }) })
 await page.goto(`/events/${id}`)
 await page.getByRole('checkbox').check()
 await page.getByRole('button', { name: 'Request ticket', exact: true }).click()
 await expect.poll(() => page.evaluate(() => (window as unknown as { testMessages: string[] }).testMessages.length)).toBe(1)
 await page.getByRole('button', { name: 'Cancel request', exact: true }).click()
 await expect(page.getByRole('button', { name: 'Request ticket', exact: true })).toBeEnabled({ timeout: 1500 })
 await page.evaluate(() => {
  const request = JSON.parse((window as unknown as { testMessages: string[] }).testMessages[0]!)
  window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'CWI', isInvocation: false, id: request.id, status: 'success', result: { network: 'testnet' } }) }))
 })
 await expect(page.getByRole('alert')).toContainText('Request cancelled')
 expect(await page.evaluate(() => (window as unknown as { testMessages: string[] }).testMessages.length)).toBe(1)
 expect(posted).toBe(0)
})

test('opening an attendee ticket prepares headers without wallet calls or a displayed verdict',async({page,context})=>{
 const {ticketFixture}=await import('./helpers/ticket-fixture.ts')
 const {requestProofBytes}=await import('../src/marketplace/request-proof.ts')
 const {Utils}=await import('@bsv/sdk')
 const {parseProviderHeader}=await import('../src/headers/validate.ts')
 const {CHECKPOINT}=await import('../src/headers/checkpoint.ts')
 const f=await ticketFixture(crypto.randomUUID()),auth=await accountApi(context)
 f.issue.inputs[0].sourceTransaction!.merklePath!.blockHeight=1762325
 f.pkg.atomicBeefBase64=Utils.toBase64(f.transfer.toAtomicBEEF())
 const proofContext={eventId:id,revision:1,venue:f.identity,attendee:f.identity,origin:'http://127.0.0.1:4175',request:f.destination}
 const signature=await f.wallet.createSignature({...f.destination.recipient,data:requestProofBytes(proofContext)})
 const record={id:crypto.randomUUID(),eventId:id,eventRevision:1,event,owner:f.identity,pkg:f.pkg,request:f.destination,attendeeProof:{...proofContext,signature:Utils.toBase64(signature.signature)},status:'complete'}
 auth.setSession({identityKey:f.identity,network:'testnet',expiresAt:new Date(Date.now()+3600000).toISOString()})
 let walletCalls=0,downloads=0
 await context.route('http://localhost:3321/**',r=>{walletCalls++;return r.abort()})
 await context.route('**/api/tickets',r=>r.fulfill({json:{tickets:[record],nextOffset:null}}))
 await context.route('**/api/tickets/requests**',r=>r.fulfill({json:{requests:[],nextOffset:null}}))
 await context.route(`**/api/tickets/${record.id}`,r=>r.fulfill({json:record}))
 await context.route('**/api/tickets/header-preparation',r=>r.fulfill({json:{network:'testnet',checkpoint:CHECKPOINT,tip:1762325,state:'ready'}}))
 const fixtures=await Promise.all([import('./fixtures/headers/woc-1762324.json',{with:{type:'json'}}),import('./fixtures/headers/woc-1762325.json',{with:{type:'json'}})])
 const bytes=Buffer.from(fixtures.map(x=>parseProviderHeader(x.default,'whatsonchain',x.default.height).hex).join(''),'hex')
 await context.route('**/api/headers/range?**',r=>{downloads++;return r.fulfill({body:bytes,headers:{'X-TicketSV-Header-Start':'1762324','X-TicketSV-Header-Count':'2','X-TicketSV-Header-Network':'testnet','X-TicketSV-Header-Checkpoint':CHECKPOINT.hash,'X-TicketSV-Header-Comparison':'server-reported'}})})
 await page.goto('/tickets');await page.getByRole('button',{name:'View ticket',exact:true}).click()
 await expect(page.getByText('Preparation needs attention. Select Verify ticket to see the checks.')).toBeVisible()
 expect(downloads).toBe(1);expect(walletCalls).toBe(0)
 await expect(page.getByRole('heading',{name:/Ticket verification:/})).toHaveCount(0)
 await page.getByRole('button',{name:'Verify ticket',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Ticket verification: rejected'})).toBeVisible()
 expect(downloads).toBe(1);expect(walletCalls).toBe(0)
})
