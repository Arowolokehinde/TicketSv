import {PrivateKey,ProtoWallet,Utils} from '@bsv/sdk'
import {SCANNER_AUTH_PROTOCOL,SCANNER_AUTH_KEY,SCANNER_AUTH_STORAGE,scannerPermitBytes,type ScannerPermit} from '../src/scanner/authorization.ts'
import {beforeAll,afterAll,it,expect} from 'vitest'
import {chromium,type Browser} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
let browser:Browser,bundle:string
beforeAll(async()=>{
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"',__TICKETSV_AUTH_IDENTITY__:JSON.stringify(new PrivateKey(7).toPublicKey().toString())},build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/session-navigation-browser-entry.tsx'),name:'SessionNavigationTest',formats:['iife']}}})
 const result=Array.isArray(built)?built[0]:built
 if(!('output' in result))throw Error('Missing browser bundle')
 bundle=result.output.filter(p=>p.type==='chunk').map(p=>p.code).join('\n');browser=await chromium.launch({headless:true})
},20000)
afterAll(async()=>{await browser?.close()})
it('keeps the confirmed session and document when navigating from Events to Dashboard and back',async()=>{
 const context=await browser.newContext(),page=await context.newPage();let sessions=0
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 await context.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session'){sessions++;return route.fulfill({json:{identityKey:'02'+'11'.repeat(32),network:'testnet',expiresAt:new Date(Date.now()+3600000).toISOString()}})}
  return route.fulfill({json:{tickets:[],requests:[],events:[],nextOffset:null}})
 })
 try{
  await page.goto('https://ticketsv.example/events');await page.addScriptTag({content:bundle});await page.evaluate('window.SessionNavigationTest.mount()')
  await page.waitForFunction(()=>!document.querySelector('.app-account')?.hasAttribute('disabled'))
  await page.evaluate('window.originalDocumentMarker = true')
  const initialSessions=sessions
  await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Dashboard',exact:true}).click()
  await page.getByText('YOUR TICKETS',{exact:true}).waitFor({timeout:2000})
  expect(await page.evaluate('window.originalDocumentMarker')).toBe(true)
  expect(sessions).toBe(initialSessions)
  expect(await page.getByText('Checking your session…',{exact:true}).count()).toBe(0)
  await page.goBack();await page.waitForURL('**/events')
  expect(await page.evaluate('window.originalDocumentMarker')).toBe(true)
  expect(sessions).toBe(initialSessions)
 }finally{await context.close()}
},10000)
it('shows no session-check message and fetches no private tickets before initial authentication resolves',async()=>{
 const context=await browser.newContext(),page=await context.newPage();let release!:()=>void,privateReads=0
 const pending=new Promise<void>(resolve=>{release=resolve})
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 await context.route('**/api/auth/session',async route=>{await pending;return route.fulfill({status:401,json:{error:'Sign in to continue.'}})})
 await context.route('**/api/tickets**',route=>{privateReads++;return route.abort()})
 try{
  await page.goto('https://ticketsv.example/tickets');await page.addScriptTag({content:bundle});await page.evaluate('window.SessionNavigationTest.mount()')
  await page.getByRole('navigation',{name:'Primary navigation'}).waitFor()
  expect(await page.getByText('Checking your session…',{exact:true}).count()).toBe(0)
  expect(await page.locator('.workspace-loading').count()).toBe(0)
  expect(privateReads).toBe(0)
  release();await page.getByRole('heading',{name:'Connect your wallet to continue.'}).waitFor()
  expect(privateReads).toBe(0)
 }finally{release();await context.close()}
})

async function offlinePermit(expired=false):Promise<ScannerPermit>{
 const wallet=new ProtoWallet(new PrivateKey(7)),now=Date.now(),identityKey=new PrivateKey(8).toPublicKey().toString()
 const permit:ScannerPermit={kind:'ticketsv-scanner-authorization',version:1,scope:'scanner',network:'testnet',origin:'https://ticketsv.example',identityKey,issuedAt:expired?now-7200000:now,expiresAt:expired?now-3600000:now+3600000,nonce:crypto.randomUUID(),signature:''}
 permit.signature=Utils.toBase64((await wallet.createSignature({protocolID:SCANNER_AUTH_PROTOCOL,keyID:SCANNER_AUTH_KEY,counterparty:'anyone',data:scannerPermitBytes(permit)})).signature)
 return permit
}
it('requires sign-in for both scanner routes and admits any signed-in wallet without wallet calls',async()=>{
 for(const signedIn of [false,true])for(const path of ['/scanner','/scanner/prepare','/scanner/headers','/scanner/activity']){
  const context=await browser.newContext(),page=await context.newPage();let wallets=0
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
  await context.route(/localhost:(3321|2121)/,route=>{wallets++;return route.abort()})
  await context.route('**/api/auth/session',route=>route.fulfill(signedIn?{json:{identityKey:new PrivateKey(8).toPublicKey().toString(),network:'testnet',expiresAt:new Date(Date.now()+3600000).toISOString()}}:{status:401,json:{error:'Sign in to continue.'}}))
  try{
   await page.goto('https://ticketsv.example'+path);await page.addScriptTag({content:bundle});await page.evaluate('window.SessionNavigationTest.mount()')
   await page.getByRole('heading',{name:signedIn?(path.endsWith('/headers')?'Block headers.':path.endsWith('/activity')?'App activity.':'Scan a ticket.'):'Connect your wallet to continue.',exact:true}).waitFor()
   expect(await page.getByRole('button',{name:'Load published events',exact:true}).count()).toBe(signedIn&&(path==='/scanner'||path==='/scanner/prepare')?1:0)
   expect(wallets).toBe(0)
  }finally{await context.close()}
 }
},15000)
it('reopens a scanner offline only with an unexpired server-signed permit, without any API or wallet contact',async()=>{
 for(const kind of ['valid','tampered','expired']){
  const context=await browser.newContext(),page=await context.newPage(),permit=await offlinePermit(kind==='expired');let contacts=0
  if(kind==='tampered')permit.identityKey=new PrivateKey(9).toPublicKey().toString()
  await context.route('**/*',route=>{if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});contacts++;return route.abort()})
  try{
   await page.goto('https://ticketsv.example/scanner');await page.addScriptTag({content:bundle})
   await page.evaluate(({permit,key})=>{Object.defineProperty(navigator,'onLine',{get:()=>false});localStorage.setItem(key,JSON.stringify(permit))},{permit,key:SCANNER_AUTH_STORAGE})
   await page.evaluate('window.SessionNavigationTest.mount()')
   await page.getByRole('heading',{name:kind==='valid'?'Scan a ticket.':'Sign in online to use this scanner.',exact:true}).waitFor()
   expect(contacts).toBe(0)
  }finally{await context.close()}
 }
},10000)
it('revokes saved offline scanner access on sign-out while retaining ticket storage',async()=>{
 const context=await browser.newContext(),page=await context.newPage(),permit=await offlinePermit();let signedIn=true
 await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
 await context.route('**/api/auth/session',route=>route.fulfill(signedIn?{json:{identityKey:permit.identityKey,network:'testnet',expiresAt:new Date(permit.expiresAt).toISOString()}}:{status:401,json:{error:'Sign in'}}))
 await context.route('**/api/auth/logout',route=>{signedIn=false;return route.fulfill({json:{signedOut:true}})})
 try{
  await page.goto('https://ticketsv.example/scanner');await page.addScriptTag({content:bundle});await page.evaluate(({permit,key})=>{localStorage.setItem(key,JSON.stringify(permit));localStorage.setItem('synthetic-ticket-preservation','keep')},{permit,key:SCANNER_AUTH_STORAGE})
  await page.evaluate('window.SessionNavigationTest.mount()');await page.getByRole('heading',{name:'Scan a ticket.',exact:true}).waitFor()
  await page.getByRole('button',{name:'Account',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await page.getByRole('heading',{name:'Connect your wallet to continue.',exact:true}).waitFor()
  expect(await page.evaluate(key=>localStorage.getItem(key),SCANNER_AUTH_STORAGE)).toBeNull()
  expect(await page.evaluate(()=>localStorage.getItem('synthetic-ticket-preservation'))).toBe('keep')
 }finally{await context.close()}
})

it('uses a valid scanner permit when connectivity fails despite an online browser indicator, but never overrides HTTP 401',async()=>{
 for(const denied of [false,true]){
  const context=await browser.newContext(),page=await context.newPage(),permit=await offlinePermit()
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}))
  await context.route('**/api/auth/session',route=>denied?route.fulfill({status:401,json:{error:'Sign in'}}):route.abort())
  try{
   await page.goto('https://ticketsv.example/scanner');await page.addScriptTag({content:bundle});await page.evaluate(({permit,key})=>localStorage.setItem(key,JSON.stringify(permit)),{permit,key:SCANNER_AUTH_STORAGE})
   await page.evaluate('window.SessionNavigationTest.mount()')
   await page.getByRole('heading',{name:denied?'Connect your wallet to continue.':'Scan a ticket.',exact:true}).waitFor()
   if(denied)expect(await page.evaluate(key=>localStorage.getItem(key),SCANNER_AUTH_STORAGE)).toBeNull()
  }finally{await context.close()}
 }
})
