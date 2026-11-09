import {afterAll,beforeAll,expect,it} from 'vitest'
import {chromium,type Browser} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
import {attendeeOfflineFixture} from './helpers/attendee-offline-fixture.ts'
import {accountApi} from './helpers/account-api.ts'
declare global {interface Window {HeaderMiningTest:typeof import('./helpers/app-header-browser-entry.tsx');AttendeeMiningChecks:string[];AttendeeMiningFail:boolean}}
let browser:Browser,bundle:string
beforeAll(async()=>{
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"','import.meta.env.VITE_SHARED_HEADERS':'"true"'},plugins:[{name:'synthetic-preparation-boundary',transform(_code,id){if(id.endsWith('/src/events/verify-venue-ticket.ts'))return `export async function verifyVenueTicket(pkg){window.AttendeeMiningChecks.push(pkg.atomicBeefBase64);if(window.AttendeeMiningFail)throw Error('Temporary header delay');return {verdict:'incomplete',checks:[],presentedTransferMined:false,anchorHeights:[]}}`}}],build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/app-header-browser-entry.tsx'),name:'HeaderMiningTest',formats:['iife']}}})
 const result=Array.isArray(built)?built[0]:built
 if(!('output' in result))throw Error('Missing mining test bundle')
 bundle=result.output.filter(p=>p.type==='chunk').map(p=>p.code).join('\n');browser=await chromium.launch({headless:true})
},20000)
afterAll(async()=>{await browser?.close()})
it('prepares after mining detection and retains the mined envelope when header preparation fails',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),f=await attendeeOfflineFixture()
 try{
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 const auth=await accountApi(context);auth.setSession({identityKey:f.identity,network:'testnet',expiresAt:new Date(Date.now()+3600000).toISOString()})
 const initial=structuredClone(f.record),proof=f.tx.merklePath!.toHex()
 f.tx.merklePath=undefined
 const {Utils}=await import('@bsv/sdk');initial.pkg!.atomicBeefBase64=Utils.toBase64(f.tx.toAtomicBEEF())
 await context.route('**/api/tickets',route=>route.fulfill({json:{tickets:[initial],nextOffset:null}}))
 await context.route('**/api/tickets/requests',route=>route.fulfill({json:{requests:[],nextOffset:null}}))
 await context.route(`**/api/tickets/${initial.id}`,route=>route.fulfill({json:initial}))
 await context.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/tx/**',route=>route.fulfill({json:{txid:initial.txid,txStatus:'MINED',blockHeight:1762324,blockHash:'00'.repeat(32),merklePath:proof}}))
 let walletCalls=0;await context.route(/localhost:(3321|2121)/,route=>{walletCalls++;return route.abort()})
 await page.goto('http://127.0.0.1:4175/tickets');await page.addScriptTag({content:bundle})
 await page.evaluate(()=>{window.AttendeeMiningChecks=[];window.AttendeeMiningFail=false;window.HeaderMiningTest.mount()})
 await page.getByRole('button',{name:'View ticket',exact:true}).click()
 await page.waitForFunction(()=>window.AttendeeMiningChecks.length===1)
 await page.evaluate(()=>{window.AttendeeMiningFail=true})
 await page.getByRole('button',{name:'Check mining evidence',exact:true}).click()
 await page.getByRole('alert').filter({hasText:'Temporary header delay'}).waitFor({timeout:1500})
 const calls=await page.evaluate(()=>window.AttendeeMiningChecks)
 expect(calls).toHaveLength(2);expect(calls[1]).toBe(f.record.pkg!.atomicBeefBase64)
 await page.evaluate(()=>{window.AttendeeMiningFail=false})
 await page.getByRole('button',{name:'Verify ticket',exact:true}).click()
 await page.waitForFunction(()=>window.AttendeeMiningChecks.length===3)
 expect((await page.evaluate(()=>window.AttendeeMiningChecks))[2]).toBe(f.record.pkg!.atomicBeefBase64)
 expect(walletCalls).toBe(0)
 }finally{await context.close()}
},15000)
