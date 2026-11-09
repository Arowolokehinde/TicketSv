import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser,type BrowserContext,type Page} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
import {handoffFixture} from './helpers/handoff-fixture.ts'
import {attendeeOfflineFixture} from './helpers/attendee-offline-fixture.ts'
import {newSettlement,readSettlement,type HandoffSettlement} from '../src/handoff/settlement.ts'
import type {RecipientRecord} from '../src/handoff/types.ts'
import {recipientKey} from '../src/handoff/store.ts'
import {invitationFor} from '../src/handoff/evidence.ts'
import {accountApi} from './helpers/account-api.ts'
declare global {interface Window {DashboardHandoffTest:typeof import('./helpers/dashboard-handoff-browser-entry.tsx')}}
let browser:Browser,bundle:string
beforeAll(async()=>{
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/dashboard-handoff-browser-entry.tsx'),name:'DashboardHandoffTest',formats:['iife']}}})
 const result=Array.isArray(built)?built[0]:built
 if(!('output' in result))throw Error('Missing dashboard test bundle')
 bundle=result.output.filter(p=>p.type==='chunk').map(p=>p.code).join('\n')
 browser=await chromium.launch({headless:true})
},20000)
afterAll(async()=>{await browser?.close()})
async function setup(context:BrowserContext,owner:string){
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 const auth=await accountApi(context)
 const session=(identityKey:string)=>({identityKey,network:'testnet',expiresAt:new Date(Date.now()+3600000).toISOString()})
 auth.setSession(session(owner))
 await context.route('**/api/tickets',route=>route.fulfill({json:{tickets:[],nextOffset:null}}))
 await context.route('**/api/tickets/requests',route=>route.fulfill({json:{requests:[],nextOffset:null}}))
 let walletCalls=0
 await context.route(/localhost:(3321|2121)/,route=>{walletCalls++;return route.abort()})
 return {switchAccount:(owner:string)=>auth.setSession(session(owner)),walletCalls:()=>walletCalls}
}
async function mount(page:Page,url='http://127.0.0.1:4175/tickets'){
 await page.goto(url);await page.addScriptTag({content:bundle})
}
async function render(page:Page){await page.evaluate(()=>window.DashboardHandoffTest.mount());await page.getByText('YOUR TICKETS',{exact:true}).waitFor()}
async function fixture(origin?:string){
 const f=await handoffFixture(true,origin),at=new Date().toISOString(),settlement=readSettlement({...newSettlement(f.ticket),import:{id:'completed-import',startedAt:at,finishedAt:at,outcome:'complete'},wallet:{state:'present',checkedAt:at,reason:'Matching ticket and receiving instructions found.'}})
 const recipient:RecipientRecord={kind:'ticketsv-handoff-recipient',version:1,id:recipientKey(f.request),revision:0,request:f.request,ticket:f.ticket}
 return {...f,settlement,recipient}
}
async function seed(page:Page,settlement:HandoffSettlement,recipient?:RecipientRecord){await page.evaluate(async({settlement,recipient})=>{const api=window.DashboardHandoffTest;if(recipient)await api.recipientStore.save(recipient,undefined);await api.settlementStore.save(settlement,undefined)},{settlement,recipient})}
it('shows one received handoff with saved wallet status, survives reload, and opens its exact confirmation record',async()=>{
 const f=await fixture(),context=await browser.newContext(),page=await context.newPage(),auth=await setup(context,f.ticket.holder)
 try{
 await mount(page);await seed(page,f.settlement,f.recipient);await render(page)
 await page.getByText('Received handoff',{exact:true}).waitFor({timeout:1500})
 expect(await page.locator('.dashboard-tickets article').count()).toBe(1)
 expect(await page.getByText('Wallet record: present',{exact:false}).isVisible()).toBe(true)
 expect(await page.getByText('Import response: accepted',{exact:false}).isVisible()).toBe(true)
 expect(await page.getByText('Your first ticket starts with an event.',{exact:true}).count()).toBe(0)
 const link=page.getByRole('link',{name:'View received ticket'}),href=await link.getAttribute('href')
 expect(href).toBe('/offline/handoff?transfer='+encodeURIComponent(f.settlement.id))
 await page.reload();await page.addScriptTag({content:bundle});await render(page)
 await page.getByRole('link',{name:'View received ticket'}).waitFor({timeout:1500})
 await mount(page,'http://127.0.0.1:4175'+href)
 await page.evaluate(()=>window.DashboardHandoffTest.mount())
 const selected=page.getByRole('combobox',{name:'Saved transfer'})
 await selected.waitFor({timeout:1500});expect(await selected.inputValue()).toBe(f.settlement.id)
 expect(await page.getByText('Wallet record:',{exact:false}).isVisible()).toBe(true)
 expect(auth.walletCalls()).toBe(0)
 }finally{await context.close()}
},10000)
it('includes historical-origin handoffs, preserves issued tickets, and filters by signed account',async()=>{
 const f=await fixture(),other=await fixture('http://other-site.test'),issued=(await attendeeOfflineFixture()).record
 const context=await browser.newContext(),page=await context.newPage(),auth=await setup(context,f.ticket.holder)
 try{
 await context.route('**/api/tickets',route=>route.fulfill({json:{tickets:[issued],nextOffset:null}}))
 await mount(page);await seed(page,f.settlement)
 await seed(page,other.settlement)
 const senderIdentity=(await f.sender.getPublicKey({identityKey:true})).publicKey
 await render(page)
 await page.getByText('Received handoff',{exact:true}).first().waitFor({timeout:1500})
 await page.getByText('Ticket received',{exact:true}).waitFor();expect(await page.locator('.dashboard-tickets article').count()).toBe(3)
 auth.switchAccount(senderIdentity)
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await page.getByText('Received handoff',{exact:true}).first().waitFor({state:'detached',timeout:1500})
 await page.getByText('Ticket received',{exact:true}).waitFor()
 expect(await page.getByText('Received handoff',{exact:true}).count()).toBe(0)
 expect(auth.walletCalls()).toBe(0)
 }finally{await context.close()}
})
it('retains a received ticket when the dashboard API is unavailable and does not infer wallet presence from an accepted import',async()=>{
 const f=await fixture(),settlement=readSettlement({...f.settlement,wallet:undefined})
 const context=await browser.newContext(),page=await context.newPage(),auth=await setup(context,f.ticket.holder)
 try{
 await context.route('**/api/tickets',route=>route.fulfill({status:503,json:{error:'API temporarily unavailable'}}))
 await mount(page);await seed(page,settlement);await render(page)
 await page.getByText('Received handoff',{exact:true}).waitFor({timeout:1500})
 expect(await page.getByText('Import response: accepted',{exact:false}).isVisible()).toBe(true)
 expect(await page.getByText('Wallet record: not checked',{exact:false}).isVisible()).toBe(true)
 expect(auth.walletCalls()).toBe(0)
 }finally{await context.close()}
})

it('shows a recipient-only device copy without inventing import or wallet success',async()=>{
 const f=await fixture(),context=await browser.newContext(),page=await context.newPage(),auth=await setup(context,f.ticket.holder)
 try{
 await mount(page)
 await page.evaluate(async(recipient)=>window.DashboardHandoffTest.recipientStore.save(recipient,undefined),f.recipient)
 await render(page)
 await page.getByText('Received handoff',{exact:true}).waitFor({timeout:1500})
 expect(await page.getByText('Import response: not attempted on this device',{exact:false}).isVisible()).toBe(true)
 expect(await page.getByText('Wallet record: not checked',{exact:false}).isVisible()).toBe(true)
 expect(await page.getByRole('link',{name:'View received ticket'}).getAttribute('href')).toBe('/offline/handoff?request='+encodeURIComponent(f.recipient.id))
 expect(auth.walletCalls()).toBe(0)
 }finally{await context.close()}
})

it('opens receiving and transfer preparation from the sidebar without wallet calls',async()=>{
 const f=await fixture(),context=await browser.newContext(),page=await context.newPage(),auth=await setup(context,f.ticket.holder)
 try{
 await mount(page);await render(page)
 const rail=page.getByRole('navigation',{name:'Ticket holder navigation'})
 expect(await rail.getByRole('link',{name:'Create event',exact:true}).getAttribute('href')).toBe('/venue')
 expect(await rail.getByRole('link',{name:'Receive ticket',exact:true}).getAttribute('href')).toBe('/offline/handoff?step=receive')
 expect(await rail.getByRole('link',{name:'Transfer ticket',exact:true}).getAttribute('href')).toBe('/offline/handoff?step=prepare')
 await mount(page,'http://127.0.0.1:4175/offline/handoff?step=receive')
 await page.evaluate(()=>window.DashboardHandoffTest.mount())
 await page.getByRole('heading',{name:'Receive a ticket.',exact:true}).waitFor({timeout:1500})
 expect(await page.getByRole('button',{name:'Receive',exact:true}).getAttribute('aria-current')).toBe('step')
 await mount(page,'http://127.0.0.1:4175/offline/handoff?step=prepare')
 await page.evaluate(()=>window.DashboardHandoffTest.mount())
 await page.getByRole('heading',{name:'Prepare your ticket.',exact:true}).waitFor({timeout:1500})
 expect(await page.getByRole('button',{name:'Prepare',exact:true}).getAttribute('aria-current')).toBe('step')
 expect(auth.walletCalls()).toBe(0)
 }finally{await context.close()}
})

it('reviews the public organiser without key entry, blocks mismatches and reuses an explicitly saved review offline',async()=>{
 const f=await fixture(),context=await browser.newContext(),page=await context.newPage()
 let calls=0,publicReads=0,venue=f.ticket.holder
 const invitation=invitationFor(f.source,1762424)
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname.startsWith('/api/')||url.hostname==='localhost'){calls++;return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'})})
 await context.route(`**/api/marketplace/events/${invitation.eventId}`,route=>{publicReads++;return route.fulfill({json:{...invitation.event,id:invitation.eventId,revision:1,venueIdentity:venue}})})
 const load=async(value=invitation)=>page.getByLabel('Load invitation file',{exact:true}).setInputFiles({name:'invitation.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))})
 try{
 await mount(page,'http://127.0.0.1:4175/offline/handoff?step=receive');await page.evaluate(()=>window.DashboardHandoffTest.mount())
 await page.getByRole('heading',{name:'Receive a ticket.',exact:true}).waitFor()
 expect(await page.getByRole('navigation',{name:'Ticket holder navigation'}).isVisible()).toBe(true)
 expect(await page.getByRole('button',{name:'Prepare',exact:true}).count()).toBe(0)
 await load()
 const create=page.getByRole('button',{name:'Create receiving request',exact:true})
 await page.getByRole('alert').filter({hasText:'does not match the published event'}).waitFor({timeout:1500})
 expect(await create.isDisabled()).toBe(true)
 expect(await page.getByLabel('Trusted venue identity',{exact:true}).count()).toBe(0)
 venue=f.source.trustedVenue
 await page.getByRole('button',{name:'Retry event lookup',exact:true}).click()
 const save=page.getByRole('button',{name:'Save organiser review',exact:true})
 await save.waitFor();expect(await save.isDisabled()).toBe(true)
 await page.getByRole('checkbox',{name:/I reviewed this published event/}).check();await save.click()
 await page.getByRole('heading',{name:'Saved organiser review',exact:true}).waitFor()
 expect(await create.isDisabled()).toBe(true)
 expect(await page.getByRole('button',{name:'Prepare this device online',exact:true}).isEnabled()).toBe(true)
 await page.getByRole('checkbox',{name:/I authorize receiving-key and identity signatures/}).check()
 expect(await create.isEnabled()).toBe(true);expect(publicReads).toBe(2);expect(calls).toBe(0)
 // Reopen without network availability: local approval is explicit and dated.
 await mount(page,'http://127.0.0.1:4175/offline/handoff?step=receive')
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.DashboardHandoffTest.mount()})
 await load();await page.getByRole('heading',{name:'Saved organiser review',exact:true}).waitFor()
 await page.getByRole('checkbox',{name:/I authorize receiving-key and identity signatures/}).check()
 expect(await page.getByRole('button',{name:'Create receiving request',exact:true}).isEnabled()).toBe(true)
 expect(publicReads).toBe(2);expect(calls).toBe(0)
 await load({...invitation,trustedVenue:f.ticket.holder})
 await page.getByRole('alert').filter({hasText:'identity changed'}).waitFor()
 expect(await page.getByRole('button',{name:'Create receiving request',exact:true}).isDisabled()).toBe(true)
 expect(publicReads).toBe(2);expect(calls).toBe(0)
 }finally{await context.close()}
})

it('blocks unavailable publications without offering manual identity entry or wallet calls',async()=>{
 const f=await fixture(),context=await browser.newContext(),page=await context.newPage()
 let walletCalls=0
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 await context.route('**/api/marketplace/events/**',route=>route.fulfill({status:404,json:{error:'This event is not published.'}}))
 await context.route(/localhost:(3321|2121)/,route=>{walletCalls++;return route.abort()})
 try{
 await mount(page,'http://127.0.0.1:4175/offline/handoff?step=receive');await page.evaluate(()=>window.DashboardHandoffTest.mount())
 await page.getByLabel('Load invitation file',{exact:true}).setInputFiles({name:'invitation.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invitationFor(f.source,1762424)))})
 await page.getByRole('alert').filter({hasText:'not published'}).waitFor()
 expect(await page.getByRole('button',{name:'Create receiving request',exact:true}).isDisabled()).toBe(true)
 expect(await page.getByRole('button',{name:'Prepare this device online',exact:true}).isDisabled()).toBe(true)
 expect(await page.getByLabel('Trusted venue identity',{exact:true}).count()).toBe(0)
 expect(await page.evaluate(()=>window.DashboardHandoffTest.organiserReviewStore.list())).toEqual([])
 expect(walletCalls).toBe(0)
 }finally{await context.close()}
})

it('requires explicit review of differing event details and never replaces a changed organiser pin',async()=>{
 const f=await fixture(),context=await browser.newContext(),page=await context.newPage(),invitation=invitationFor(f.source,1762424)
 let venue=invitation.trustedVenue
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 await context.route('**/api/marketplace/events/**',route=>route.fulfill({json:{...invitation.event,name:'Published event name',id:invitation.eventId,revision:1,venueIdentity:venue}}))
 try{
 await mount(page,'http://127.0.0.1:4175/offline/handoff?step=receive');await page.evaluate(()=>window.DashboardHandoffTest.mount())
 await page.getByLabel('Load invitation file',{exact:true}).setInputFiles({name:'invitation.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invitation))})
 await page.getByRole('heading',{name:'Published event name',exact:true}).waitFor()
 expect(await page.getByText('The sender’s event details differ from the reviewed event',{exact:true}).isVisible()).toBe(true)
 const save=page.getByRole('button',{name:'Save organiser review',exact:true});expect(await save.isDisabled()).toBe(true)
 await page.getByRole('checkbox',{name:/I reviewed this published event and the differences/}).check();await save.click()
 await page.getByRole('heading',{name:'Saved organiser review',exact:true}).waitFor()
 venue=f.ticket.holder
 await page.getByRole('button',{name:'Review current publication',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'does not match the published event'}).waitFor()
 expect(await page.getByRole('button',{name:'Create receiving request',exact:true}).isDisabled()).toBe(true)
 const saved=await page.evaluate(()=>window.DashboardHandoffTest.organiserReviewStore.list())
 expect(saved).toHaveLength(1);expect(saved[0].venueIdentity).toBe(invitation.trustedVenue);expect(saved[0].revision).toBe(0)
 }finally{await context.close()}
})

it('resumes an existing received ticket and opens its saved confirmation without repeating import',async()=>{
 const f=await fixture(),context=await browser.newContext(),page=await context.newPage(),auth=await setup(context,f.ticket.holder)
 try{
 await mount(page,'http://127.0.0.1:4175/offline/handoff?step=receive')
 await seed(page,f.settlement,f.recipient)
 await page.evaluate(()=>window.DashboardHandoffTest.mount())
 await page.getByRole('heading',{name:'Receive a ticket.',exact:true}).waitFor()
 await page.getByLabel('Saved receiving request',{exact:true}).selectOption(f.recipient.id)
 await page.getByRole('heading',{name:'Your request is saved',exact:true}).waitFor()
 expect(await page.getByRole('button',{name:'Choose ticket file',exact:true}).isVisible()).toBe(true)
 await page.getByRole('button',{name:'Continue to confirmation',exact:true}).click()
 await page.getByRole('heading',{name:'Confirm your transfer.',exact:true}).waitFor()
 expect(await page.getByLabel('Saved transfer',{exact:true}).inputValue()).toBe(f.settlement.id)
 expect(await page.getByText('Wallet record:',{exact:false}).isVisible()).toBe(true)
 expect(await page.getByRole('button',{name:'Add received ticket to wallet',exact:true}).count()).toBe(0)
 expect(auth.walletCalls()).toBe(0)
 }finally{await context.close()}
})

it('opens a Send deep link without starting preparation or wallet actions',async()=>{
 const context=await browser.newContext(),page=await context.newPage();let contacts=0
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='localhost'||url.pathname.startsWith('/api/')){contacts++;return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'})})
 try{
 await mount(page,'http://127.0.0.1:4175/offline/handoff?step=send');await page.evaluate(()=>window.DashboardHandoffTest.mount())
 await page.getByRole('heading',{name:'Send to its next holder.',exact:true}).waitFor()
 expect(await page.getByRole('button',{name:'Send',exact:true}).getAttribute('aria-current')).toBe('step')
 expect(contacts).toBe(0)
 }finally{await context.close()}
})

it('recovers a historical-origin handoff on a fresh device, saves it offline, and verifies without server or wallet contacts',async()=>{
 const f=await fixture('http://localhost:5175'),{archiveIdentity,validateReceivedArchive}=await import('../src/handoff/archive.ts')
 const archive=await validateReceivedArchive({ticket:f.ticket,settlement:f.settlement},f.ticket.holder),id=archiveIdentity(archive)
 const context=await browser.newContext(),page=await context.newPage(),auth=await setup(context,f.ticket.holder)
 let archiveReads=0,allRequests=0
 context.on('request',()=>allRequests++)
 await context.route('**/api/tickets/received**',route=>{
  const req=route.request(),url=new URL(req.url())
  if(req.method()==='POST')return route.fulfill({json:{id:archiveIdentity(req.postDataJSON()),synchronised:true}})
  archiveReads++
  return route.fulfill({json:url.pathname.endsWith('/'+id)?archive:{tickets:[{id}],nextOffset:null}})
 })
 try{
  await mount(page);await render(page)
  await page.getByRole('link',{name:'View received ticket'}).waitFor({timeout:3000})
  expect(archiveReads).toBe(2)
  expect(await page.getByText('Wallet record: present',{exact:false}).isVisible()).toBe(true)
  await mount(page,'http://127.0.0.1:4175/offline/tickets');await page.evaluate(()=>window.DashboardHandoffTest.mount())
  await page.getByRole('link',{name:'Open received ticket'}).waitFor()
  const href=await page.getByRole('link',{name:'Open received ticket'}).getAttribute('href')
  await mount(page,'http://127.0.0.1:4175'+href);await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{get:()=>false});window.DashboardHandoffTest.mount()})
  const verify=page.getByRole('button',{name:'Verify locally',exact:true});await verify.waitFor()
  const before=allRequests
  await verify.click();await page.getByText('Ticket evidence: incomplete',{exact:true}).waitFor()
  expect(allRequests).toBe(before);expect(auth.walletCalls()).toBe(0)
 }finally{await context.close()}
},15000)

it('recovers an existing ticket file without signing and keeps recipient mismatch errors visible',async()=>{
 const f=await fixture('http://localhost:5175'),context=await browser.newContext(),page=await context.newPage(),auth=await setup(context,f.ticket.holder)
 const {archiveIdentity}=await import('../src/handoff/archive.ts')
 await context.route('**/api/tickets/received**',route=>route.fulfill({json:route.request().method()==='POST'?{id:archiveIdentity(route.request().postDataJSON())}:{tickets:[],nextOffset:null}}))
 try{
  await mount(page);await render(page)
  await page.getByText('Recover an existing received ticket',{exact:true}).click()
  const upload=page.getByLabel('Load existing received ticket file',{exact:true})
  await upload.setInputFiles({name:'updated-ticket.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.ticket))})
  await page.getByRole('link',{name:'View received ticket'}).waitFor()
  await page.getByText('Received ticket saved locally and synchronised.',{exact:false}).waitFor()
  await upload.setInputFiles({name:'wrong-ticket.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...f.ticket,holder:f.source.holder}))})
  await page.getByRole('alert').waitFor()
  expect(await page.getByRole('link',{name:'View received ticket'}).count()).toBe(1)
  expect(auth.walletCalls()).toBe(0)
 }finally{await context.close()}
},10000)

