import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser,type BrowserContext,type Page} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
import type {PublishedEvent} from '../src/marketplace/types.ts'
declare global {interface Window {EventsCatalogueTest:typeof import('./helpers/events-browser-entry.tsx')}}
const id='b54a41c1-e532-42d4-8f86-04f91c547d73'
const event:PublishedEvent={id,name:'Harbour Nights',description:'An evening of music by the water.',date:'2027-06-12',time:'19:30',timezone:'Africa/Lagos',venue:'Harbour Hall',address:'14 Marina Road',revision:1,venueIdentity:'0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'}
const second={...event,id:'c54a41c1-e532-42d4-8f86-04f91c547d73',name:'Sunday Sessions'}
let browser:Browser,bundle:string
beforeAll(async()=>{
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/events-browser-entry.tsx'),name:'EventsCatalogueTest',formats:['iife']}}})
 const result=Array.isArray(built)?built[0]:built
 if(!('output' in result))throw Error('Missing catalogue test bundle')
 bundle=result.output.filter(p=>p.type==='chunk').map(p=>p.code).join('\n')
 browser=await chromium.launch({headless:true})
},20000)
afterAll(async()=>{await browser?.close()})
async function setup(context:BrowserContext){
 let wallets=0
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 await context.route('**/api/auth/session',route=>route.fulfill({status:401,json:{error:'Sign in to continue.'}}))
 await context.route(/localhost:(3321|2121)/,route=>{wallets++;return route.abort()})
 return ()=>wallets
}
async function mount(page:Page,path='/events'){await page.goto('http://127.0.0.1:4175'+path);await page.addScriptTag({content:bundle});await page.evaluate(()=>window.EventsCatalogueTest.mount())}
it('shows an honest empty catalogue after successful loading, distinct from a failed API request',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),wallets=await setup(context)
 let fail=true
 await context.route('**/api/marketplace/events**',route=>route.fulfill(fail?{status:503,json:{error:'Events temporarily unavailable'}}:{json:{events:[],nextOffset:null}}))
 try{
 await mount(page)
 await page.getByRole('alert').waitFor()
 expect(await page.getByRole('heading',{name:'No events available yet.',exact:true}).count()).toBe(0)
 fail=false;await page.getByRole('button',{name:'Try again',exact:true}).click()
 await page.getByRole('heading',{name:'No events available yet.',exact:true}).waitFor({timeout:1500})
 expect(await page.getByRole('link',{name:'Create an event',exact:true}).count()).toBe(0)
 expect(await page.locator('.market-card').count()).toBe(0);expect(wallets()).toBe(0)
 }finally{await context.close()}
})
it('keeps paginated events unique and opens the selected event without contacting a wallet',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),wallets=await setup(context)
 await context.route('**/api/marketplace/events**',route=>{
  const url=new URL(route.request().url())
  return route.fulfill({json:url.pathname.endsWith(id)?event:url.searchParams.get('offset')==='24'?{events:[event,second],nextOffset:null}:{events:[event],nextOffset:24}})
 })
 try{
 await mount(page);await page.getByRole('link',{name:'Explore Harbour Nights',exact:true}).waitFor()
 await page.getByRole('button',{name:'More events',exact:true}).click()
 await page.getByRole('link',{name:'Explore Sunday Sessions',exact:true}).waitFor()
 expect(await page.locator('.market-card').count()).toBe(2)
 expect(await page.getByRole('link',{name:'Explore Harbour Nights',exact:true}).count()).toBe(1)
 await mount(page,'/events/'+id)
 await page.getByRole('heading',{name:event.name,exact:true}).waitFor()
 expect(await page.getByText(event.description,{exact:true}).isVisible()).toBe(true)
 expect(await page.getByText(event.address,{exact:false}).isVisible()).toBe(true)
 await page.getByRole('button',{name:'Request ticket',exact:true}).click()
 await page.getByRole('dialog').waitFor()
 expect(wallets()).toBe(0)
 }finally{await context.close()}
})

it('shows a past marketplace event without offering a new ticket request',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),wallets=await setup(context)
 const past={...event,date:'2000-01-01',requestsOpen:false}
 await context.route('**/api/marketplace/events**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith(id)?past:{events:[past],nextOffset:null}}))
 try{
 await mount(page);await page.getByRole('link',{name:'Explore Harbour Nights',exact:true}).waitFor()
 expect(await page.getByText('Past event',{exact:true}).isVisible()).toBe(true)
 await mount(page,'/events/'+id);await page.getByRole('heading',{name:'Requests closed.',exact:true}).waitFor({timeout:1500})
 expect(await page.getByRole('button',{name:'Request ticket',exact:true}).count()).toBe(0)
 expect(wallets()).toBe(0)
 }finally{await context.close()}
})
