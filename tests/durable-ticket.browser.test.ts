import {test,expect,type Page} from '@playwright/test'
import {syntheticSigningWallet} from './helpers/synthetic-signing-wallet.ts'
import {readFile} from 'node:fs/promises'
const consent='I authorize a NEW testnet ticket, its wallet broadcast and venue signature. Funding inputs and fees will be used.'
const panel=(page:Page)=>page.locator('.durable-ticket-panel')
async function configure(page:Page,identity:string){
 await page.goto('/dev/feasibility')
 await expect(panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true})).toBeDisabled()
 await panel(page).getByLabel('Venue identity for durable issuance').fill(identity)
 await panel(page).getByLabel(consent).check()
}
test('explicit broadcast creates a persisted diagnostic, reload is passive and resale waits for mining',async({page})=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey,calls:string[]=[]
 await page.route('http://localhost:3321/**',async r=>{
  const method=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet,args=r.request().postDataJSON();calls.push(method)
  if(method==='createAction'){expect(args.options.noSend).toBe(false);expect(args.options.acceptDelayedBroadcast).toBe(false)}
  await r.fulfill({json:await (wallet[method] as (a:unknown)=>Promise<unknown>)(args)})
 })
 await configure(page,identity);expect(calls).toEqual([])
 await panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true}).click()
 await expect(panel(page).getByText('Issuance saved. Mining is not yet verified.',{exact:true})).toBeVisible()
 await expect(panel(page).getByRole('button',{name:'Sign offline transfer',exact:true})).toBeDisabled()
 const downloaded=page.waitForEvent('download');await panel(page).getByRole('button',{name:'Download diagnostic record',exact:true}).click()
 const saved=JSON.parse(await readFile((await (await downloaded).path())!,'utf8'))
 expect(saved.attempt).toMatchObject({phase:'issue',status:'complete'});expect(saved.pkg.lineageRawTxs).toHaveLength(1);expect(saved.buyer.requestId).not.toBe(saved.pkg.request.requestId)
 const before=calls.length;await page.reload()
 await expect(panel(page).getByText('Saved diagnostic loaded. Wallet readiness must be checked again.',{exact:true})).toBeVisible()
 expect(calls).toHaveLength(before)
 await expect(panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true})).toBeDisabled()
 await expect(panel(page).getByRole('button',{name:'Sign offline transfer',exact:true})).toBeDisabled()
})
test('storage failure prevents any wallet action',async({page})=>{
 await page.addInitScript(()=>{const open=IDBFactory.prototype.open;IDBFactory.prototype.open=function(name,...args){if(name==='counterfoil-durable-ticket-v1')throw new Error('Synthetic storage unavailable');return open.call(this,name,...args)}})
 let calls=0;await page.route('http://localhost:3321/**',r=>{calls++;return r.abort()})
 await page.goto('/dev/feasibility')
 await expect(panel(page).getByRole('alert')).toContainText('storage')
 await expect(panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true})).toBeDisabled()
 expect(calls).toBe(0)
})
test('failed mutation and safe error details survive reload and prevent reissue',async({page})=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey,calls:string[]=[]
 await page.route('http://localhost:3321/**',async r=>{
  const method=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet;calls.push(method)
  if(method==='createAction'){await r.fulfill({status:400,json:{message:'Synthetic rejected request',privatePayload:'SECRET_DO_NOT_SAVE'}});return}
  await r.fulfill({json:await (wallet[method] as (a:unknown)=>Promise<unknown>)(r.request().postDataJSON())})
 })
 await configure(page,identity);await panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true}).click()
 await expect(panel(page).getByRole('alert')).toContainText('HTTP status 400');await page.reload()
 await expect(panel(page).getByText('Wallet outcome requires review. Further mutations are blocked.',{exact:true})).toBeVisible()
 const downloaded=page.waitForEvent('download');await panel(page).getByRole('button',{name:'Download diagnostic record',exact:true}).click()
 const saved=await readFile((await (await downloaded).path())!,'utf8')
 expect(saved).toContain('Synthetic rejected request');expect(saved).not.toContain('SECRET_DO_NOT_SAVE')
 await expect(panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true})).toBeDisabled()
 expect(calls.filter(c=>c==='createAction')).toHaveLength(1)
})
test('two tabs cannot claim the same issuance and pending reload stays blocked',async({page,context})=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 let release!:()=>void;const held=new Promise<void>(r=>{release=r});let creates=0
 await context.route('http://localhost:3321/**',async r=>{
  const method=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet
  if(method==='createAction'){creates++;await held;await r.abort().catch(()=>{});return}
  await r.fulfill({json:await (wallet[method] as (a:unknown)=>Promise<unknown>)(r.request().postDataJSON())}).catch(()=>{})
 })
 const other=await context.newPage()
 try{
  await configure(page,identity);await configure(other,identity)
  await panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true}).click()
  await expect.poll(()=>creates).toBe(1)
  await panel(other).getByRole('button',{name:'Issue and broadcast test ticket',exact:true}).click()
  await expect(panel(other).getByRole('alert')).toContainText('changed in another tab')
  await page.reload();await expect(panel(page).getByText('Wallet outcome requires review. Further mutations are blocked.',{exact:true})).toBeVisible()
  expect(creates).toBe(1)
 }finally{release()}
})

test('a journal write failure before the wallet call prevents issuance',async({page})=>{
 await page.addInitScript(()=>{
  const put=IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name==='counterfoil-durable-ticket-v1')throw new DOMException('Synthetic quota exceeded','QuotaExceededError');return put.apply(this,args)}
 })
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey;let calls=0
 await page.route('http://localhost:3321/**',r=>{calls++;return r.abort()})
 await configure(page,identity)
 await panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true}).click()
 await expect(panel(page).getByRole('alert')).toContainText('storage write failed')
 expect(calls).toBe(0)
})
test('timeout persists uncertainty and a late createAction cannot request a venue signature',async({page})=>{
 await page.clock.install()
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey,calls:string[]=[]
 let release!:()=>void;const held=new Promise<void>(r=>{release=r})
 await page.route('http://localhost:3321/**',async r=>{
  const method=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet;calls.push(method)
  const value=await (wallet[method] as (a:unknown)=>Promise<unknown>)(r.request().postDataJSON())
  if(method==='createAction')await held
  await r.fulfill({json:value}).catch(()=>{})
 })
 try{
  await configure(page,identity);await panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true}).click()
  await expect.poll(()=>calls.includes('createAction')).toBe(true);await page.clock.fastForward(60100)
  await expect(panel(page).getByRole('alert')).toContainText('outcome may be unknown');release()
  await page.reload();await expect(panel(page).getByText('Wallet outcome requires review. Further mutations are blocked.',{exact:true})).toBeVisible()
  expect(calls).not.toContain('createSignature')
  await expect(panel(page).getByRole('button',{name:'Issue and broadcast test ticket',exact:true})).toBeDisabled()
 }finally{release()}
})

test('known source-preflight failure exposes read-only review, missing proof validation keeps it blocked',async({page})=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const {issueTicketExperiment}=await import('../src/wallet/ticket-experiment.ts')
 const {Transaction,MerklePath,Utils}=await import('@bsv/sdk')
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','recovery'),tx=Transaction.fromHex(prep.pkg.lineageRawTxs[0])
 tx.merklePath=new MerklePath(1,[[{offset:1,hash:tx.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
 prep.pkg.atomicBeefBase64=Utils.toBase64(tx.toAtomicBEEF())
 const record={version:1,id:'recovery',revision:4,trusted:identity,eventId:'event',ticketId:'ticket',pkg:prep.pkg,buyer:prep.destination,references:[prep.pkg.current.txid],attempt:{id:'failed-transfer',phase:'transfer',status:'failed',at:'2026-10-24T16:00:00.000Z'},failure:{name:'Error',message:'Expected a newly created, unmined transaction.',method:'getPublicKey'}}
 const calls:string[]=[]
 wallet.listOutputs=async()=>({totalOutputs:1,outputs:[{outpoint:`${tx.id('hex')}.0`,satoshis:1,spendable:true}],BEEF:tx.toBEEF()})
 await page.route('http://localhost:3321/**',async r=>{
  const method=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet;calls.push(method)
  if(!['getNetwork','getPublicKey','listOutputs'].includes(method)){await r.abort();return}
  await r.fulfill({json:await (wallet[method] as (a:unknown)=>Promise<unknown>)(r.request().postDataJSON())})
 })
 await page.goto('/dev/feasibility')
 await page.evaluate(async record=>{await new Promise<void>((resolve,reject)=>{
  const req=indexedDB.open('counterfoil-durable-ticket-v1',1)
  req.onupgradeneeded=()=>req.result.createObjectStore('records')
  req.onsuccess=()=>{const db=req.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put(record,'current');tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(new Error('seed failed'))}
 })},record)
 await page.reload();const review=panel(page).getByRole('button',{name:'Review mined-source preflight failure',exact:true})
 await expect(review).toBeVisible();expect(calls).toEqual([])
 await review.click();await expect(panel(page).getByRole('alert')).toContainText('header')
 expect(calls).toContain('listOutputs');expect(calls.every(c=>['getNetwork','getPublicKey','listOutputs'].includes(c))).toBe(true)
 await page.reload();await expect(panel(page).getByText('Saved attempt: transfer — failed.',{exact:true})).toBeVisible()
 await expect(panel(page).getByRole('button',{name:'Sign offline transfer',exact:true})).toBeDisabled()
 await page.evaluate(async()=>{await new Promise<void>(resolve=>{const req=indexedDB.open('counterfoil-durable-ticket-v1',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),get=store.get('current');get.onsuccess=()=>{const r=get.result;r.failure.method='signAction';store.put(r,'current')};tx.oncomplete=()=>{db.close();resolve()}}})})
 await page.reload();await expect(review).toHaveCount(0)
})
