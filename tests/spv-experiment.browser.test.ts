import {expect,test} from '@playwright/test'
import type {Page} from '@playwright/test'
import {Transaction} from '@bsv/sdk'
import fixture from './fixtures/headers/mined-ancestor.json' with {type:'json'}
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
import ca from './fixtures/headers/chaintracks-1762324.json' with {type:'json'}
import cb from './fixtures/headers/chaintracks-1762325.json' with {type:'json'}
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
async function load(page:Page){await page.getByLabel('Load signing result for SPV').setInputFiles({name:'signing-result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))})}
async function sources(page:Page){
 const calls:string[]=[]
 await page.route('https://api.whatsonchain.com/**',async r=>{calls.push(r.request().url());await r.fulfill({json:r.request().url().includes('1762324')?a:b})})
 await page.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/**',async r=>{calls.push(r.request().url());await r.fulfill({json:r.request().url().endsWith('1762324')?ca:cb})})
 return calls
}
test('saves validated progress on cancellation and resumes after reopening from the saved boundary',async({page})=>{
 const tx=Transaction.fromAtomicBEEF(fixture.final.atomicBeef);tx.merklePath!.blockHeight=1764620
 const evidence={kind:'counterfoil-signing-result',network:'testnet',final:{txid:tx.id('hex'),atomicBeef:tx.toAtomicBEEF()}}
 let release!:()=>void;const held=new Promise<void>(r=>{release=r})
 await page.route('https://api.whatsonchain.com/**',async r=>{if(!r.request().url().includes('1762324'))await held;await r.fulfill({json:a}).catch(()=>{})})
 await page.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/**',async r=>{if(!r.request().url().endsWith('1762324'))await held;await r.fulfill({json:ca}).catch(()=>{})})
 try{
  await page.goto('/dev/feasibility');const panel=page.locator('.spv-panel')
  await panel.getByLabel('Load signing result for SPV').setInputFiles({name:'newer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(evidence))})
  await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
  await expect(panel.getByRole('status')).toContainText('1 / 2297 headers cross-checked')
  await expect(panel.getByText('Header source requests this session: 2',{exact:true})).toBeVisible()
  await panel.getByRole('button',{name:'Cancel header sync',exact:true}).click()
  await expect(panel.getByRole('alert')).toContainText('cancelled')
  await expect(panel.getByText(/Stored headers: 1762324–1762324/)).toBeVisible()
  await page.reload()
  await expect(panel.getByText(/Stored headers: 1762324–1762324/)).toBeVisible()
  release();await page.unroute('https://api.whatsonchain.com/**');await page.unroute('https://arcade-v2-testnet-us-1.bsvblockchain.tech/**')
  const calls=await sources(page);await load(page)
  await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
  await expect(panel.getByText('Header snapshot saved.')).toBeVisible()
  expect(calls.filter(url=>url.includes('1762324'))).toHaveLength(2)
  expect(calls.filter(url=>url.includes('1762325'))).toHaveLength(2)
 }finally{release()}
})
test('an already covered anchor only rechecks the saved tip; full recheck remains explicit',async({page})=>{
 const calls=await sources(page);await page.goto('/dev/feasibility');await load(page)
 const panel=page.locator('.spv-panel')
 await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible();calls.length=0
 await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible()
 expect(calls).toHaveLength(2);expect(calls.every(url=>url.includes('1762325'))).toBe(true)
 calls.length=0
 await panel.getByRole('button',{name:'Recheck all headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible();expect(calls).toHaveLength(4)
})
test('a competing saved snapshot stops a stale sync instead of overwriting it',async({page})=>{
 const records=[parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)]
 const prefix=makeSnapshot(records.slice(0,1)),newer=makeSnapshot(records,'2026-10-24T20:00:00.000Z')
 await sources(page);await page.goto('/dev/feasibility')
 async function write(value:typeof prefix){await page.evaluate(async snapshot=>new Promise<void>(resolve=>{const req=indexedDB.open('counterfoil-spv-experiment-v1',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(snapshot,'accepted');tx.oncomplete=()=>{db.close();resolve()}}}),value)}
 await write(prefix);await page.reload();await load(page)
 let release!:()=>void,started=false;const held=new Promise<void>(r=>{release=r})
 await page.route('https://api.whatsonchain.com/**',async r=>{if(r.request().url().includes('1762325')){started=true;await held};await r.fulfill({json:r.request().url().includes('1762324')?a:b}).catch(()=>{})})
 const panel=page.locator('.spv-panel')
 try{
  await panel.getByRole('button',{name:'Sync required headers',exact:true}).click();await expect.poll(()=>started).toBe(true)
  await write(newer);release()
  await expect(panel.getByRole('alert')).toContainText('changed in another tab')
  await page.reload();await expect(panel.getByText(/Stored headers:/)).toContainText('2026-10-24T20:00:00.000Z')
 }finally{release()}
})
test('syncs explicitly, verifies offline without contacts and restores persisted headers',async({page,context})=>{
 const calls=await sources(page);const wallet:string[]=[]
 await page.route('http://localhost:3321/**',async r=>{wallet.push(r.request().url());await r.abort()})
 await page.goto('/dev/feasibility');await expect(page.getByRole('heading',{name:'Local SPV experiment.'})).toBeVisible()
 const panel=page.locator('.spv-panel')
 await expect(panel.getByText('No local header snapshot.')).toBeVisible();expect(calls).toEqual([])
 await load(page);await panel.getByRole('button',{name:'Verify locally',exact:true}).click()
 await expect(panel.getByRole('alert')).toContainText('required block header missing')
 await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible();expect(calls).toHaveLength(4)
 await context.setOffline(true)
 await panel.getByRole('button',{name:'Verify locally',exact:true}).click()
 await expect(panel.getByText('Transaction evidence verified against local headers.')).toBeVisible()
 await expect(panel.getByText('Verification server contacts: 0')).toBeVisible();expect(calls).toHaveLength(4);expect(wallet).toEqual([])
 await context.setOffline(false);await page.reload();await expect(panel.getByText(/Stored headers: 1762324–1762325/)).toBeVisible()
 expect(calls).toHaveLength(4);await load(page);await panel.getByRole('button',{name:'Verify locally',exact:true}).click()
 await expect(panel.getByText('Transaction evidence verified against local headers.')).toBeVisible()
})
test('failed sync preserves stored snapshot and clears the previous verdict',async({page})=>{
 await sources(page);await page.goto('/dev/feasibility');await load(page)
 const panel=page.locator('.spv-panel');await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible()
 await panel.getByRole('button',{name:'Verify locally',exact:true}).click()
 await expect(panel.getByText('Transaction evidence verified against local headers.')).toBeVisible()
 await page.route('https://api.whatsonchain.com/**',r=>r.fulfill({status:503,body:'unavailable'}))
 await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByRole('alert')).toContainText('503',{timeout:15000})
 await expect(panel.getByText(/Stored headers: 1762324–1762325/)).toBeVisible()
 await expect(panel.getByText('Transaction evidence verified against local headers.')).toHaveCount(0)
})
test('recovers a failed browser fetch without restarting or saving incomplete headers',async({page})=>{
 const calls=await sources(page);let attempts=0
 await page.route('https://api.whatsonchain.com/**',async r=>{
  calls.push(r.request().url());attempts++
  if(attempts===1){await r.abort('failed');return}
  await r.fulfill({json:r.request().url().includes('1762324')?a:b})
 })
 await page.goto('/dev/feasibility');await load(page);const panel=page.locator('.spv-panel')
 await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible({timeout:10000})
 expect(calls).toHaveLength(5)
 await expect(panel.getByText('Header source requests this session: 5',{exact:true})).toBeVisible()
 await panel.getByRole('button',{name:'Verify locally',exact:true}).click()
 await expect(panel.getByText('Transaction evidence verified against local headers.')).toBeVisible()
 expect(calls).toHaveLength(5)
})
test('rejects corrupted persisted headers instead of reusing a successful verdict',async({page})=>{
 await sources(page);await page.goto('/dev/feasibility');await load(page)
 const panel=page.locator('.spv-panel');await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible()
 await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
  const req=indexedDB.open('counterfoil-spv-experiment-v1',1)
  req.onsuccess=()=>{const db=req.result;const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({id:'fake'},'accepted');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}
 }))
 await page.reload();await expect(panel.getByRole('alert')).toContainText('Stored headers failed validation')
 await expect(panel.getByText('No local header snapshot.')).toBeVisible()
 await load(page)
 await panel.getByRole('button',{name:'Recheck all headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible()
 await panel.getByRole('button',{name:'Verify locally',exact:true}).click()
 await expect(panel.getByText('Transaction evidence verified against local headers.')).toBeVisible()
})
test('cancels active sync and ignores late responses while retaining persisted headers',async({page})=>{
 await sources(page);await page.goto('/dev/feasibility');await load(page)
 const panel=page.locator('.spv-panel');await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible()
 const old=await panel.getByText(/Stored headers:/).textContent()
 let started=false;let release!:()=>void;const held=new Promise<void>(r=>{release=r})
 await page.route('https://api.whatsonchain.com/**',async r=>{started=true;await held;await r.fulfill({json:a}).catch(()=>{})})
 await panel.getByRole('button',{name:'Sync required headers',exact:true}).click();await expect.poll(()=>started).toBe(true)
 await panel.getByRole('button',{name:'Cancel header sync',exact:true}).click()
 await expect(panel.getByRole('alert')).toContainText('cancelled');release()
 await expect(panel.getByRole('button',{name:'Verify locally',exact:true})).toBeEnabled()
 await page.reload();await expect(panel.getByText(/Stored headers:/)).toHaveText(old!)
})
test('an interrupted IndexedDB write retains the previously accepted snapshot after reload',async({page})=>{
 await page.addInitScript(()=>{
  const original=IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){
   const request=original.apply(this,args)
   if(sessionStorage.getItem('test-abort-header-write')==='yes' && this.name==='snapshots')queueMicrotask(()=>this.transaction.abort())
   return request
  }
 })
 await sources(page);await page.goto('/dev/feasibility');await load(page)
 const panel=page.locator('.spv-panel');await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByText('Header snapshot saved.')).toBeVisible()
 const old=await panel.getByText(/Stored headers:/).textContent()
 await page.evaluate(()=>sessionStorage.setItem('test-abort-header-write','yes'))
 await panel.getByRole('button',{name:'Sync required headers',exact:true}).click()
 await expect(panel.getByRole('alert')).toContainText('not saved')
 await page.reload();await expect(panel.getByText(/Stored headers:/)).toHaveText(old!)
})
