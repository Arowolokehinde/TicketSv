import {test,expect,type Page} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
import {readFile} from 'node:fs/promises'
import {MerklePath,Utils} from '@bsv/sdk'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import {transactionSummary} from '../src/settlement/evidence.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
import type {TransferReview} from '../src/settlement/types.ts'
declare global{interface Window{ArcTest:typeof import('./helpers/arc-browser-entry.ts')}}
const provider='https://arcade-v2-testnet-us-1.bsvblockchain.tech'
const snapshot=makeSnapshot([parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)])
let bundle:string
// Only this synthetic UI harness stubs SPV and mining-anchor boundaries. Ticket signatures,
// byte review, production UI, fetch and actual browser IndexedDB are real.
// Genuine anchor/proof verification runs separately in arc-submission.test.ts.
test.beforeAll(async()=>{
 const target=resolve('src/verification/signing-spv.ts')
 const output=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-anchor-test-boundary',async load(id){
  if(id===target){const source=await readFile(target,'utf8');return source.slice(0,source.indexOf('export async function verifySigningEvidence'))+`export async function verifySigningEvidence(evidence,snapshot){if(!snapshot)throw new Error('Verification incomplete — required block header missing');return {txid:evidence.txid,anchors:[1],subjectMined:!!Transaction.fromAtomicBEEF(evidence.atomicBeef).merklePath,proofBytes:evidence.atomicBeef.length,snapshotId:snapshot.id}}`}
  if(id===resolve('src/settlement/evidence.ts')){const source=await readFile(id,'utf8');return source.replace(/export function verifyMiningAnchor[\s\S]*?(?=export function minedCandidate)/,'export function verifyMiningAnchor(o,snapshot){return !!snapshot}\n')}
 }}],build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/arc-browser-entry.ts'),name:'ArcTest',formats:['iife']}}})
 const result=Array.isArray(output)?output[0]:output
 if(!('output' in result))throw new Error('No test bundle')
 bundle=result.output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n')
})
async function fixture():Promise<TransferReview>{
 const f=await ticketFixture();f.issue.merklePath=new MerklePath(1,[[{offset:0,hash:'11'.repeat(32)},{offset:1,hash:f.issue.id('hex'),txid:true}]]);f.pkg.atomicBeefBase64=Utils.toBase64(f.transfer.toAtomicBEEF())
 return {...transactionSummary({kind:'counterfoil-reopening-evidence',version:1,trusted:f.identity,pkg:f.pkg,buyer:f.destination}),snapshotId:snapshot.id}
}
async function mount(page:Page,review?:TransferReview){
 await page.route('**/arc-test',r=>r.fulfill({body:'<!doctype html><div id="test-root"></div>',contentType:'text/html'}))
 await page.goto('/arc-test');await page.addScriptTag({content:bundle})
 if(review)await page.evaluate(async({evidence,snapshot})=>{
  for(const [name,store,key,value] of [['counterfoil-reopening-evidence-v1','evidence','current',evidence],['counterfoil-spv-experiment-v1','snapshots','accepted',snapshot]] as const){
   await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction(store,'readwrite');t.objectStore(store).put(value,key);t.oncomplete=()=>{db.close();resolve()};t.onabort=()=>reject(t.error)}})
  }
 },{evidence:review.evidence,snapshot})
 await page.evaluate(()=>window.ArcTest.render())
}
async function routes(page:Page,id:string){
 const requests:string[]=[]
 await page.route('http://localhost:3321/**',r=>{throw new Error('Unexpected wallet request: '+r.request().url())})
 await page.route(provider+'/**',r=>{requests.push(r.request().method()+' '+new URL(r.request().url()).pathname);if(r.request().url().endsWith('/policy'))return r.fulfill({json:{policy:{maxtxsizepolicy:1000000,miningFee:{satoshis:0,bytes:1000}}}});if(r.request().method()==='POST')return r.fulfill({json:{txid:id,txStatus:'SEEN_ON_NETWORK'}});return r.fulfill({status:404,json:{error:'transaction not found'}})})
 return requests
}
test('real app panel makes no startup network requests and blocks absent evidence',async({page})=>{
 const calls=await routes(page,'ab'.repeat(32));await page.goto('/dev/feasibility')
 const panel=page.getByRole('region',{name:'Online transfer submission.'})
 await expect(panel).toBeVisible();await expect(panel.getByRole('button',{name:'Submit reviewed transfer to testnet',exact:true})).toBeDisabled();expect(calls).toEqual([])
})
test('claims are atomic across tabs and stale writes cannot replace a newer record',async({page,context})=>{
 const r=await fixture();await mount(page)
 const other=await context.newPage();await mount(other)
 const outcomes=await Promise.all([page,other].map(p=>p.evaluate(async r=>{try{return {ok:true,record:await window.ArcTest.claimSubmission(r,undefined)}}catch{return {ok:false}}},r)))
 expect(outcomes.filter(x=>x.ok)).toHaveLength(1)
 const stored=await page.evaluate(id=>window.ArcTest.loadSettlement(id),r.txid);expect(stored!.attempts[0].outcome).toBe('pending')
 const stale=await other.evaluate(async record=>{try{await window.ArcTest.saveSettlement({...record!,revision:3},1);return false}catch{return true}},stored)
 expect(stale).toBe(true);expect(await page.evaluate(id=>window.ArcTest.loadSettlement(id),r.txid)).toEqual(stored)
})
test('saved attempt history cannot be rewritten',async({page})=>{
 const r=await fixture();await mount(page)
 const result=await page.evaluate(async r=>{
  const first=await window.ArcTest.claimSubmission(r,undefined)
  const completed={...first,revision:2,attempts:first.attempts.map(a=>({...a,outcome:'unknown' as const,finishedAt:new Date().toISOString(),error:'Original uncertain response'}))}
  await window.ArcTest.saveSettlement(completed,1)
  try{await window.ArcTest.saveSettlement({...completed,revision:3,attempts:completed.attempts.map(a=>({...a,error:'Rewritten response'}))},2);return false}catch{return true}
 },r)
 expect(result).toBe(true)
})
test('synthetic flow sends reviewed bytes once, persists response and does not resubmit on reload',async({page})=>{
 const r=await fixture(),calls=await routes(page,r.txid);await mount(page,r);expect(calls).toEqual([])
 await page.getByRole('button',{name:'Review saved transfer',exact:true}).click()
 await expect(page.getByText('Embedded fee: 0 testnet satoshis',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Check provider policy',exact:true}).click()
 await page.getByLabel('I authorize publishing this exact signed transfer to testnet, spending the displayed inputs and embedded fee.').check()
 const sent=page.waitForRequest(q=>q.url()===provider+'/tx'&&q.method()==='POST')
 await page.getByRole('button',{name:'Submit reviewed transfer to testnet',exact:true}).click()
 expect((await sent).postData()).toBe(r.efHex)
 await expect(page.getByText('Provider status: SEEN_ON_NETWORK',{exact:true})).toBeVisible()
 expect(calls.filter(x=>x==='POST /tx')).toHaveLength(1)
 await mount(page)
 await expect(page.getByText('Saved submission attempts: 1',{exact:true})).toBeVisible()
 expect(calls.filter(x=>x==='POST /tx')).toHaveLength(1)
 await expect(page.getByRole('button',{name:'Download updated ticket package',exact:true})).toBeDisabled()
})
test('lost POST response stays unknown; status check never triggers another POST',async({page})=>{
 const r=await fixture(),calls=await routes(page,r.txid);await mount(page,r)
 await page.route(provider+'/tx',route=>{calls.push('POST /tx');return route.abort('failed')})
 await page.getByRole('button',{name:'Review saved transfer',exact:true}).click();await page.getByRole('button',{name:'Check provider policy',exact:true}).click()
 await page.getByLabel('I authorize publishing this exact signed transfer to testnet, spending the displayed inputs and embedded fee.').check()
 await page.getByRole('button',{name:'Submit reviewed transfer to testnet',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('unknown')
 await page.getByRole('button',{name:'Check transfer status',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('not found')
 expect(calls.filter(x=>x==='POST /tx')).toHaveLength(1)
 await expect(page.getByRole('button',{name:'Submit reviewed transfer to testnet',exact:true})).toBeDisabled()
})
test('provider MINED without a proof never becomes locally verified mining',async({page})=>{
 const r=await fixture();await routes(page,r.txid);await mount(page,r)
 await page.route(provider+'/tx/'+r.txid,q=>q.fulfill({json:{txid:r.txid,txStatus:'MINED'}}))
 await page.getByRole('button',{name:'Check transfer status',exact:true}).click()
 await expect(page.getByText('Provider status: MINED',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Verify mining proof locally',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('not available')
 await expect(page.getByRole('button',{name:'Download updated ticket package',exact:true})).toBeDisabled()
})
test('missing headers and changed saved evidence block submission without overwriting source stores',async({page})=>{
 const r=await fixture(),calls=await routes(page,r.txid);await mount(page,r)
 await page.evaluate(()=>new Promise<void>((resolve,reject)=>{const q=indexedDB.open('counterfoil-spv-experiment-v1');q.onsuccess=()=>{const db=q.result,t=db.transaction('snapshots','readwrite');t.objectStore('snapshots').delete('accepted');t.oncomplete=()=>{db.close();resolve()};t.onabort=()=>reject(t.error)}}))
 await page.getByRole('button',{name:'Review saved transfer',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('incomplete')
 await expect(page.getByRole('button',{name:'Submit reviewed transfer to testnet',exact:true})).toBeDisabled()
 expect(calls).toEqual([])
 await mount(page,r)
 await page.getByRole('button',{name:'Review saved transfer',exact:true}).click();await page.getByRole('button',{name:'Check provider policy',exact:true}).click()
 await page.getByLabel('I authorize publishing this exact signed transfer to testnet, spending the displayed inputs and embedded fee.').check()
 const changed={...r.evidence,buyer:{...r.evidence.buyer,requestId:'independently-replaced-request',recipient:{...r.evidence.buyer.recipient,keyID:'independently-replaced-request'}}}
 await page.evaluate(value=>new Promise<void>((resolve,reject)=>{const q=indexedDB.open('counterfoil-reopening-evidence-v1');q.onsuccess=()=>{const db=q.result,t=db.transaction('evidence','readwrite');t.objectStore('evidence').put(value,'current');t.oncomplete=()=>{db.close();resolve()};t.onabort=()=>reject(t.error)}}),changed)
 await page.getByRole('button',{name:'Submit reviewed transfer to testnet',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Saved evidence changed')
 expect(calls.filter(x=>x==='POST /tx')).toEqual([])
 const kept=await page.evaluate(()=>new Promise<unknown>((resolve)=>{const q=indexedDB.open('counterfoil-reopening-evidence-v1');q.onsuccess=()=>{const db=q.result,t=db.transaction('evidence'),r=t.objectStore('evidence').get('current');t.oncomplete=()=>{db.close();resolve(r.result)}}}))
 expect(kept).toEqual(changed)
})
test('synthetic verified export is revalidated and a failed re-review clears its verdict',async({page})=>{
 const r=await fixture();await routes(page,r.txid);await mount(page,r)
 const proof=new MerklePath(b.height,[[{offset:0,hash:'11'.repeat(32)},{offset:1,hash:r.txid,txid:true}]])
 await page.route(provider+'/tx/'+r.txid,q=>q.fulfill({json:{txid:r.txid,txStatus:'MINED',blockHeight:b.height,blockHash:b.hash,merklePath:proof.toHex()}}))
 await page.getByRole('button',{name:'Check transfer status',exact:true}).click()
 await page.getByRole('button',{name:'Verify mining proof locally',exact:true}).click()
 await expect(page.getByText('Mining proof verification: verified',{exact:true})).toBeVisible()
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download updated ticket package',exact:true}).click()
 const download=await downloaded;expect(download.suggestedFilename()).toBe('counterfoil-mined-ticket-package.json')
 const pkg=JSON.parse(await readFile((await download.path())!,'utf8'))
 expect(pkg.current).toEqual(r.evidence.pkg.current);expect(pkg.lineageRawTxs).toEqual(r.evidence.pkg.lineageRawTxs);expect(pkg.atomicBeefBase64).not.toBe(r.evidence.pkg.atomicBeefBase64)
 await page.evaluate(()=>new Promise<void>((resolve)=>{const q=indexedDB.open('counterfoil-spv-experiment-v1');q.onsuccess=()=>{const db=q.result,t=db.transaction('snapshots','readwrite');t.objectStore('snapshots').delete('accepted');t.oncomplete=()=>{db.close();resolve()}}}))
 await page.getByRole('button',{name:'Review saved transfer',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('incomplete')
 await expect(page.getByText('Mining proof verification: verified',{exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Download updated ticket package',exact:true})).toBeDisabled()
})
