import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser,type BrowserContext,type Page} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
import {accountApi} from './helpers/account-api.ts'
declare global {interface Window {AppHeaderTest:typeof import('./helpers/app-header-browser-entry.tsx')}}
let browser:Browser,bundle:string,styles:string
beforeAll(async()=>{
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/app-header-browser-entry.tsx'),name:'AppHeaderTest',formats:['iife']}}})
 const result=Array.isArray(built)?built[0]:built
 if(!('output' in result))throw Error('Missing header bundle')
 styles=result.output.flatMap(p=>p.type==='asset'&&p.fileName.endsWith('.css')?[String(p.source)]:[]).join('\n')
 bundle=result.output.filter(p=>p.type==='chunk').map(p=>p.code).join('\n')
 browser=await chromium.launch({headless:true})
},20000)
afterAll(async()=>{await browser?.close()})
async function setup(context:BrowserContext,signedIn=false){
 const calls={sessions:0,wallets:0}
 await context.route('**/*',route=>{
  const url=new URL(route.request().url())
  if(url.hostname==='localhost'){calls.wallets++;return route.abort()}
  if(url.pathname==='/api/auth/session'){calls.sessions++;return route.fulfill(signedIn?{json:{identityKey:'0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',network:'testnet',expiresAt:new Date(Date.now()+3600000).toISOString()}}:{status:401,json:{error:'Sign in to continue.'}})}
  if(url.pathname==='/api/marketplace/events')return route.fulfill({json:{events:[],nextOffset:null}})
  if(url.pathname==='/api/tickets')return route.fulfill({json:{tickets:[],nextOffset:null}})
  if(url.pathname==='/api/tickets/requests')return route.fulfill({json:{requests:[],nextOffset:null}})
  if(url.pathname==='/api/events')return route.fulfill({json:{events:[],nextOffset:null}})
  return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'})
 })
 return calls
}
async function mount(page:Page,path:string){await page.goto('http://127.0.0.1:4175'+path);await page.addStyleTag({content:styles});await page.addScriptTag({content:bundle});await page.evaluate(()=>window.AppHeaderTest.mount())}
it('shows the same primary header on public, workspace, offline, diagnostic and missing pages',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),calls=await setup(context,true)
 try{
 for(const path of ['/','/events','/tickets','/venue','/scanner','/offline/tickets','/offline/handoff?step=receive','/dev/feasibility','/dev/reopening','/missing-page']){
  await mount(page,path)
  const header=page.locator('header.app-header');await header.waitFor({timeout:1500})
  expect(await page.locator('header').count()).toBe(1)
  expect(await header.getByRole('link',{name:'TicketSV home',exact:true}).getAttribute('href')).toBe('/')
  const nav=header.getByRole('navigation',{name:'Primary navigation'})
  for(const [name,href] of [['Events','/events'],['Dashboard','/tickets'],['Scanner','/scanner']])expect(await nav.getByRole('link',{name,exact:true}).getAttribute('href')).toBe(href)
  expect(await header.getByRole('button',{name:'Account',exact:true}).isVisible()).toBe(true)
  expect(await nav.getByRole('link',{name:'Venue',exact:true}).count()).toBe(0)
  if(path==='/scanner')expect(await nav.getByRole('link',{name:'Scanner',exact:true}).getAttribute('aria-current')).toBe('page')
  if(path==='/tickets'||path==='/venue')for(const name of ['Prepare offline','Headers','App activity'])expect(await page.getByRole('navigation',{name:'Ticket holder navigation'}).getByRole('link',{name,exact:true}).count()).toBe(0)
  if(path==='/venue'){const sidebar=page.getByRole('navigation',{name:'Ticket holder navigation'});await sidebar.waitFor();expect(await sidebar.getByRole('link',{name:'Create event',exact:true}).getAttribute('aria-current')).toBe('page')}
 }
 expect(calls.wallets).toBe(0)
 }finally{await context.close()}
},25000)
it('opens an offline account panel only on demand and stops session checking when closed',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),calls=await setup(context)
 try{
 await mount(page,'/offline/tickets')
 const account=page.locator('header.app-header').getByRole('button',{name:'Account',exact:true})
 await account.waitFor({timeout:1500});expect(calls.sessions).toBe(0);expect(calls.wallets).toBe(0)
 await account.click();await page.getByRole('dialog').waitFor({timeout:1500})
 expect(calls.sessions).toBe(1);expect(calls.wallets).toBe(0)
 await page.getByRole('button',{name:'Close wallet panel',exact:true}).click()
 await page.getByRole('dialog').waitFor({state:'detached'})
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
 expect(calls.sessions).toBe(1);expect(calls.wallets).toBe(0)
 }finally{await context.close()}
})
it('keeps protected primary links behind the existing sign-in dialog for guests',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),calls=await setup(context)
 try{
 await mount(page,'/events');await page.getByRole('heading',{name:'No events available yet.',exact:true}).waitFor()
 const nav=page.getByRole('navigation',{name:'Primary navigation'})
 expect(await nav.getByRole('link',{name:'Events',exact:true}).getAttribute('aria-current')).toBe('page')
 await nav.getByRole('link',{name:'Dashboard',exact:true}).click();await page.getByRole('dialog').waitFor()
 expect(page.url()).toBe('http://127.0.0.1:4175/events');expect(calls.wallets).toBe(0)
 }finally{await context.close()}
})

it('keeps the header visible and aligned at desktop and mobile widths',async()=>{
 const context=await browser.newContext(),page=await context.newPage();await setup(context)
 try{
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:800});await mount(page,'/')
  const header=page.locator('header.app-header');await header.waitFor()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  for(const link of await header.locator('a,button').all()){
   const box=await link.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width)
  }
  await page.evaluate(()=>window.scrollTo(0,800))
  expect((await header.boundingBox())!.y).toBe(0)
 }
 }finally{await context.close()}
})

it('keeps the event manager usable on mobile and preserves draft editing without wallet calls',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),calls=await setup(context,true)
 const account=await accountApi(context)
 const id='b54a41c1-e532-42d4-8f86-04f91c547d73'
 account.records.set(id,{id,name:'Harbour Nights',description:'Live music by the water.',date:'2027-06-12',time:'19:30',timezone:'Africa/Lagos',venue:'Harbour Hall',address:'14 Marina Road',image:null,status:'draft',revision:2,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})
 try{
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:900});await mount(page,'/venue')
  await page.getByRole('heading',{name:'Harbour Nights',exact:true}).waitFor()
  expect(await page.getByText('Browser online',{exact:true}).count()).toBe(0)
  expect(await page.getByText('Device details +',{exact:true}).count()).toBe(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`/tmp/ticketsv-event-manager-${width}.png`,fullPage:true})
  await page.getByRole('button',{name:'Edit Harbour Nights',exact:true}).click()
  await page.getByRole('heading',{name:'Edit event',exact:true}).waitFor()
  expect(await page.getByLabel('Event name',{exact:true}).inputValue()).toBe('Harbour Nights')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`/tmp/ticketsv-event-editor-${width}.png`,fullPage:true})
  const timezone=page.getByRole('combobox',{name:'Timezone',exact:true})
  await timezone.fill('Madrid')
  const choices=page.getByRole('listbox',{name:'Timezones'})
  await choices.waitFor({timeout:1500})
  await page.screenshot({path:`/tmp/ticketsv-timezone-search-${width}.png`,fullPage:true})
  expect((await choices.boundingBox())!.height).toBeLessThanOrEqual(260)
  expect(await page.getByRole('option',{name:'Europe / Madrid',exact:true}).isVisible()).toBe(true)
  await timezone.press('ArrowDown');await timezone.press('Enter')
  expect(await timezone.inputValue()).toBe('Europe / Madrid')
  expect(await choices.count()).toBe(0)
  await timezone.fill('not-a-city')
  expect(await page.getByText('No matching timezones.',{exact:true}).isVisible()).toBe(true)
  await timezone.press('Escape')
  expect(await timezone.inputValue()).toBe('Europe / Madrid')
  await page.getByLabel('Event name',{exact:true}).fill('Harbour Nights updated')
  await page.getByRole('button',{name:'Save draft',exact:true}).click()
  await page.getByRole('heading',{name:'Harbour Nights updated',exact:true}).waitFor()
  expect(account.records.get(id).revision).toBe(3)
  expect(account.records.get(id).timezone).toBe('Europe/Madrid')
  account.records.set(id,{...account.records.get(id),name:'Harbour Nights',revision:2})
 }
 expect(calls.wallets).toBe(0)
 }finally{await context.close()}
},20000)
