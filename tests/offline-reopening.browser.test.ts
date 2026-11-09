import {test,expect} from '@playwright/test'

test('prepared app reopens in a new offline tab and does not cache wallet or unknown endpoints',async({page,context})=>{
 await page.goto('/dev/reopening')
 await expect(page.getByRole('heading',{name:'Offline reopening experiment.'})).toBeVisible()
 await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('App files saved')
 await page.reload()
 await expect(page.getByText('This page is controlled by the offline worker.',{exact:false})).toBeVisible()
 await context.setOffline(true)
 await page.close()
 const reopened=await context.newPage();await reopened.goto('/dev/reopening')
 await expect(reopened.getByRole('heading',{name:'Offline reopening experiment.'})).toBeVisible()
 await expect(reopened.getByText('No completed transfer saved at this browser origin.',{exact:true})).toBeVisible()
 await expect(reopened.getByRole('button',{name:'Verify saved transfer locally',exact:true})).toBeDisabled()
 const unknown=await reopened.evaluate(async()=>{try{await fetch('/wallet-api/not-cached');return false}catch{return true}})
 expect(unknown).toBe(true)
 const cached=await reopened.evaluate(async()=>{const names=await caches.keys();return (await Promise.all(names.map(async n=>(await (await caches.open(n)).keys()).map(r=>r.url)))).flat()})
 expect(cached.every(url=>new URL(url).origin==='http://127.0.0.1:4175')).toBe(true)
 expect(cached.some(url=>url.includes('3321')||url.includes('wallet-api'))).toBe(false)
 await reopened.reload();await expect(reopened.getByRole('heading',{name:'Offline reopening experiment.'})).toBeVisible()
})

import {syntheticSigningWallet} from './helpers/synthetic-signing-wallet.ts'
import {issueTicketExperiment,transferTicketExperiment} from '../src/wallet/ticket-experiment.ts'
import type {ExperimentRecord} from '../src/tickets/experiment-store.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
async function diagnostic(runId='reopening-browser'){
 const wallet=syntheticSigningWallet(),trusted=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,trusted,'event','ticket',runId),pkg=await transferTicketExperiment(wallet,prep)
 const record:ExperimentRecord={version:1,id:'reopening-browser',revision:2,trusted,eventId:'event',ticketId:'ticket',attempt:{id:'transfer',phase:'transfer',status:'complete',at:new Date().toISOString()},references:[pkg.issuance.origin.txid,pkg.current.txid],pkg,buyer:prep.destination}
 return record
}
test('a stale reopening tab cannot replace evidence saved by another tab',async({page,context})=>{
 const first=await diagnostic('first-reopening'),second=await diagnostic('second-reopening')
 await page.goto('/dev/reopening')
 async function stage(target:typeof page,record:ExperimentRecord){
  await target.getByLabel('Trusted venue identity for loaded files',{exact:true}).fill(record.trusted)
  for(const [label,value] of [['Load downloaded ticket package',record.pkg],['Load independently saved buyer request',record.buyer]] as const){
   await target.getByLabel(label,{exact:true}).setInputFiles({name:'evidence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))})
  }
 }
 await stage(page,first)
 await page.getByRole('button',{name:'Check and save loaded evidence',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('Evidence saved locally')
 const other=await context.newPage();await other.goto('/dev/reopening');await stage(other,second)
 await other.getByRole('button',{name:'Check and save loaded evidence',exact:true}).click()
 await expect(other.getByRole('status')).toContainText('Evidence saved locally')
 await page.getByRole('button',{name:'Check and save loaded evidence',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('changed in another tab')
 await page.reload()
 await expect(page.getByText(`Saved transfer: ${second.pkg!.current.txid}.0`,{exact:true})).toBeVisible()
})
test('downloaded files persist offline independently of a failed wallet journal, without importing trust',async({page,context})=>{
 const record=await diagnostic()
 await page.goto('/dev/reopening')
 const upload=async(label:string,value:unknown)=>page.getByLabel(label,{exact:true}).setInputFiles({name:'evidence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))})
 await page.getByLabel('Trusted venue identity for loaded files',{exact:true}).fill(record.trusted)
 await upload('Load downloaded ticket package',record.pkg)
 await upload('Load independently saved buyer request',record.buyer)
 await expect(page.getByLabel('Trusted venue identity for loaded files',{exact:true})).toHaveValue(record.trusted)
 // Saving evidence must never erase or turn a failed wallet attempt into success.
 const failed={...record,attempt:{...record.attempt,status:'failed' as const}}
 await page.evaluate(async value=>new Promise<void>(resolve=>{const req=indexedDB.open('counterfoil-durable-ticket-v1',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put(value,'current');tx.oncomplete=()=>{db.close();resolve()}}}),failed)
 await page.getByRole('button',{name:'Check and save loaded evidence',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('Evidence saved locally')
 await expect(page.getByRole('heading',{name:'Saved transfer verification: incomplete'})).toBeVisible()
 await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('App files saved');await page.reload()
 await context.setOffline(true);await page.close()
 const reopened=await context.newPage();await reopened.goto('/dev/reopening')
 await expect(reopened.getByText(`Saved transfer: ${record.pkg!.current.txid}.0`,{exact:true})).toBeVisible()
 const requests:string[]=[];context.on('request',r=>requests.push(r.url()))
 await reopened.getByRole('button',{name:'Verify saved transfer locally',exact:true}).click()
 await expect(reopened.getByText('recipient: pass — recipient check passed',{exact:true})).toBeVisible()
 expect(requests).toEqual([])
 expect(await reopened.evaluate(async()=>new Promise(resolve=>{const r=indexedDB.open('counterfoil-durable-ticket-v1');r.onsuccess=()=>{const db=r.result,tx=db.transaction('records'),get=tx.objectStore('records').get('current');tx.oncomplete=()=>{db.close();resolve(get.result)}}}))).toEqual(failed)
 // Wrong trust cannot replace the saved evidence or inherit its displayed verdict.
 await reopened.getByLabel('Trusted venue identity for loaded files',{exact:true}).fill(record.buyer!.recipient.publicKey)
 await reopened.getByLabel('Load downloaded ticket package',{exact:true}).setInputFiles({name:'ticket.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(record.pkg))})
 await reopened.getByLabel('Load independently saved buyer request',{exact:true}).setInputFiles({name:'request.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(record.buyer))})
 await reopened.getByRole('button',{name:'Check and save loaded evidence',exact:true}).click()
 await expect(reopened.getByRole('alert')).toContainText('rejected')
 await reopened.reload()
 await reopened.getByRole('button',{name:'Verify saved transfer locally',exact:true}).click()
 await expect(reopened.getByText('issuer: pass — issuer check passed',{exact:true})).toBeVisible()
})
test('saved journal and headers survive offline close/reopen; verification makes no wallet or provider requests',async({page,context})=>{
 const record=await diagnostic(),snapshot=makeSnapshot([parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)])
 await page.goto('/dev/reopening')
 await page.evaluate(async({record,snapshot})=>{
  for(const [name,store,key,value] of [['counterfoil-durable-ticket-v1','records','current',record],['counterfoil-spv-experiment-v1','snapshots','accepted',snapshot]] as const){
   await new Promise<void>((resolve,reject)=>{const req=indexedDB.open(name,1);req.onupgradeneeded=()=>req.result.createObjectStore(store);req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}})
  }
 },{record,snapshot})
 await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click();await expect(page.getByRole('status')).toContainText('App files saved')
 await page.reload();await context.setOffline(true);await page.close()
 const next=await context.newPage();await next.goto('/dev/reopening')
 await expect(next.getByText(`Saved transfer: ${record.pkg!.current.txid}.0`,{exact:true})).toBeVisible()
 const requests:string[]=[];context.on('request',r=>requests.push(r.url()))
 await next.getByRole('button',{name:'Verify saved transfer locally',exact:true}).click()
 await expect(next.getByRole('heading',{name:'Saved transfer verification: incomplete'})).toBeVisible()
 await expect(next.getByText('recipient: pass — recipient check passed',{exact:true})).toBeVisible()
 // Invented synthetic anchor must not be accepted against genuine checkpoint headers.
 await expect(next.getByRole('button',{name:'Check receiving key access',exact:true})).toBeDisabled()
 expect(requests).toEqual([])
 const stored=await next.evaluate(async()=>{
  async function read(name:string,store:string,key:string){return new Promise<unknown>((resolve,reject)=>{const req=indexedDB.open(name);req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction(store,'readonly'),get=tx.objectStore(store).get(key);tx.oncomplete=()=>{db.close();resolve(get.result)}}})}
  return {record:await read('counterfoil-durable-ticket-v1','records','current'),snapshot:await read('counterfoil-spv-experiment-v1','snapshots','accepted')}
 })
 expect(stored).toEqual({record,snapshot})
})
test('corrupt diagnostics fail closed without wallet traffic',async({page})=>{
 let calls=0;await page.route('http://localhost:3321/**',r=>{calls++;return r.abort()})
 await page.goto('/dev/reopening')
 await page.evaluate(async()=>{await new Promise<void>(resolve=>{const req=indexedDB.open('counterfoil-durable-ticket-v1',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put({broken:true},'current');tx.oncomplete=()=>{db.close();resolve()}}})})
 await page.reload();await expect(page.getByRole('alert')).toContainText('Saved diagnostic unavailable')
 await expect(page.getByRole('button',{name:'Verify saved transfer locally',exact:true})).toBeDisabled();expect(calls).toBe(0)
})
test('a missing app asset prevents cache readiness',async({page,context})=>{
 await page.goto('/dev/reopening')
 await context.route('**/assets/wallet-*.js',r=>r.fulfill({status:503,body:'Synthetic asset failure'}))
 await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click()
 await expect(page.getByRole('alert')).toBeVisible({timeout:15000})
 await expect(page.getByRole('status')).not.toContainText('App files saved')
 expect(await page.evaluate(async()=>(await caches.keys()).filter(n=>n.startsWith('counterfoil-reopening-')))).toEqual([])
})
test('preparing again repairs an evicted app cache before reporting readiness',async({page})=>{
 await page.goto('/dev/reopening');await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('App files saved');await page.reload()
 await page.evaluate(async()=>{for(const name of await caches.keys())await caches.delete(name)})
 await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('App files saved')
 expect(await page.evaluate(async()=>{const names=await caches.keys();return (await Promise.all(names.map(async n=>(await (await caches.open(n)).keys()).length))).reduce((a,b)=>a+b,0)})).toBeGreaterThan(1)
})

import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
test('a new worker waits for open tabs instead of taking over the reopening session',async({page,context})=>{
 // Chromium does not route SW update-script fetches through Playwright routing.
 // Serve two real builds of the worker on an isolated test origin instead.
 let worker=await readFile('dist/offline-worker.js','utf8')
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url!,'http://localhost').pathname
  try{
   if(pathname==='/offline-worker.js'){res.setHeader('Content-Type','application/javascript');res.setHeader('Cache-Control','no-store');res.end(worker);return}
   const file=pathname.startsWith('/assets/')&&!pathname.includes('..')?'dist'+pathname:'dist/index.html'
   res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file))
  }catch{res.writeHead(404);res.end()}
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 const address=server.address();if(!address||typeof address==='string')throw new Error('Test server address missing')
 const origin=`http://127.0.0.1:${address.port}`
 try{
  await page.goto(origin+'/dev/reopening');await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('App files saved');await page.reload()
  worker=worker.replace(/counterfoil-reopening-[a-f0-9]+/g,'counterfoil-reopening-update-test')
  await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Close all reopening tabs')
  expect(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true)
  expect(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration('/dev/feasibility')))).toBe(false)
  await page.close();const reopened=await context.newPage();await reopened.goto(origin+'/dev/reopening')
  await expect.poll(()=>reopened.evaluate(async()=>(await navigator.serviceWorker.getRegistration())?.waiting===null)).toBe(true)
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()))}
})

import {chromium} from '@playwright/test'
test('cached app opens offline after the test browser process is closed',async({},testInfo)=>{
 test.skip(testInfo.project.name!=='desktop','One process-restart check; phone viewport is not a physical device')
 const profile=testInfo.outputPath('cold-reopening-profile')
 let browserContext=await chromium.launchPersistentContext(profile,{headless:true})
 try{
  const page=await browserContext.newPage();await page.goto('http://127.0.0.1:4175/dev/reopening')
  await page.getByRole('button',{name:'Prepare app for offline reopening',exact:true}).click();await expect(page.getByRole('status')).toContainText('App files saved')
  await page.reload();await expect(page.getByText('This page is controlled by the offline worker.',{exact:false})).toBeVisible()
  await browserContext.close()
  browserContext=await chromium.launchPersistentContext(profile,{headless:true});await browserContext.setOffline(true)
  const reopened=await browserContext.newPage();await reopened.goto('http://127.0.0.1:4175/dev/reopening')
  await expect(reopened.getByRole('heading',{name:'Offline reopening experiment.'})).toBeVisible()
  await expect(reopened.getByText('No completed transfer saved at this browser origin.',{exact:true})).toBeVisible()
 }finally{await browserContext.close()}
})
