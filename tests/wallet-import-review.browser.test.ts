import {test,expect,type Page,type Route} from '@playwright/test'
import {build} from 'vite'
import {resolve} from 'node:path'
import {readFile} from 'node:fs/promises'
import {MerklePath,Utils,Transaction} from '@bsv/sdk'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import type {ReopeningEvidence} from '../src/offline/evidence.ts'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
declare global{interface Window{ImportReviewTest:typeof import('./helpers/import-review-browser-entry.ts')}}
const snapshot=makeSnapshot([parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)])
let bundle:string
// Only synthetic SPV anchor checking is replaced. Real ticket crypto, UI, HTTP client,
// and IndexedDB are used. These are not live wallet compatibility observations.
test.beforeAll(async()=>{
 const target=resolve('src/verification/signing-spv.ts')
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-spv-boundary',async load(id){
  if(id===target){const source=await readFile(target,'utf8');return source.slice(0,source.indexOf('export async function verifySigningEvidence'))+`export async function verifySigningEvidence(evidence,snapshot){if(!snapshot)throw new Error('Verification incomplete — required block header missing');return {txid:evidence.txid,anchors:[1],subjectMined:!!Transaction.fromAtomicBEEF(evidence.atomicBeef).merklePath,proofBytes:evidence.atomicBeef.length,snapshotId:snapshot.id}}`}
 }}],build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/import-review-browser-entry.ts'),name:'ImportReviewTest',formats:['iife']}}})
 const output=Array.isArray(built)?built[0]:built;if(!('output' in output))throw new Error('Missing bundle')
 bundle=output.output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n')
})
async function fixture(){
 const f=await ticketFixture();f.issue.merklePath=new MerklePath(1,[[{offset:0,hash:'11'.repeat(32)},{offset:1,hash:f.issue.id('hex'),txid:true}]])
 const evidence:ReopeningEvidence={kind:'counterfoil-reopening-evidence',version:1,trusted:f.identity,pkg:{...f.pkg,atomicBeefBase64:Utils.toBase64(f.transfer.toAtomicBEEF())},buyer:f.destination}
 f.transfer.merklePath=new MerklePath(b.height,[[{offset:0,hash:'22'.repeat(32)},{offset:1,hash:f.transfer.id('hex'),txid:true}]])
 const candidate={...evidence,pkg:{...evidence.pkg,atomicBeefBase64:Utils.toBase64(f.transfer.toAtomicBEEF())}}
 return {evidence,candidate}
}
async function mount(page:Page,f?:Awaited<ReturnType<typeof fixture>>){
 await page.route('**/import-review-test',r=>r.fulfill({body:'<!doctype html><div id="test-root"></div>',contentType:'text/html'}))
 await page.goto('/import-review-test');await page.addScriptTag({content:bundle})
 if(f)await page.evaluate(async({f,snapshot})=>{
  for(const [name,store,key,value] of [['counterfoil-reopening-evidence-v1','evidence','current',f.evidence],['counterfoil-spv-experiment-v1','snapshots','accepted',snapshot]] as const){
   await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction(store,'readwrite');t.objectStore(store).put(value,key);t.oncomplete=()=>{db.close();resolve()};t.onabort=()=>reject(t.error)}})
  }
  const record=await window.ImportReviewTest.ensureSettlement(f.evidence)
  await window.ImportReviewTest.saveSettlement({...record,revision:record.revision+1,candidate:f.candidate},record.revision)
 },{f,snapshot})
 await page.evaluate(()=>window.ImportReviewTest.render())
}
async function wallet(page:Page,f:Awaited<ReturnType<typeof fixture>>,hold?: (r:Route)=>void){
 const calls:string[]=[],tx=Transaction.fromAtomicBEEF(Utils.toArray(f.candidate.pkg.atomicBeefBase64,'base64')),key=f.evidence.buyer.recipient
 const output={outpoint:`${f.evidence.pkg.current.txid}.${f.evidence.pkg.current.index}`,satoshis:1,spendable:true,lockingScript:tx.outputs[f.evidence.pkg.current.index].lockingScript.toHex(),customInstructions:JSON.stringify({type:'PushDrop',protocolID:key.protocolID,keyID:key.keyID,counterparty:key.counterparty})}
 await page.route('http://localhost:3321/**',async r=>{
  if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return}
  const method=new URL(r.request().url()).pathname.split('/').at(-1)!,args=r.request().postDataJSON();calls.push(method)
  const results:Record<string,unknown>={getNetwork:{network:'testnet'},getVersion:{version:'wallet-brc100-1.0.0'},getPublicKey:{publicKey:args.identityKey?f.evidence.trusted:key.publicKey},listOutputs:{totalOutputs:1,outputs:[output]}}
  if(!(method in results))throw new Error('Unexpected wallet method '+method)
  if(method==='listOutputs'&&hold){hold(r);return}
  await r.fulfill({json:results[method],headers:{'Access-Control-Allow-Origin':'*'}})
 })
 return {calls,output}
}
test('production panel blocks missing evidence and makes no startup wallet requests',async({page})=>{
 const calls:string[]=[];await page.route('http://localhost:3321/**',r=>{calls.push(r.request().url());return r.abort()})
 await page.goto('/dev/feasibility')
 const panel=page.getByRole('region',{name:'Wallet import review.'})
 await expect(panel.getByRole('button',{name:'Review wallet ticket record',exact:true})).toBeDisabled()
 await expect(panel.getByText('No saved transfer at this browser origin.',{exact:false})).toBeVisible()
 expect(calls).toEqual([])
})
test('explicit review reads matching record without changing settlement or importing',async({page})=>{
 const f=await fixture(),{calls}=await wallet(page,f);await mount(page,f)
 const button=page.getByRole('button',{name:'Review wallet ticket record',exact:true});await expect(button).toBeEnabled();expect(calls).toEqual([])
 const before=await page.evaluate(id=>window.ImportReviewTest.loadSettlement(id),f.evidence.pkg.current.txid)
 await button.click();await expect(page.getByText('Wallet record: present',{exact:true})).toBeVisible()
 expect(calls).toEqual(['getNetwork','getPublicKey','getVersion','getPublicKey','listOutputs','getNetwork','getPublicKey'])
 expect(await page.evaluate(id=>window.ImportReviewTest.loadSettlement(id),f.evidence.pkg.current.txid)).toEqual(before)
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download wallet review observation'}).click()
 const observation=JSON.parse(await readFile((await (await pending).path())!,'utf8'));expect(observation.result.state).toBe('present');expect(observation.walletMutations).toBe(0)
})
test('missing headers prevent all wallet reads',async({page})=>{
 const f=await fixture(),{calls}=await wallet(page,f);await mount(page,f)
 await removeHeaders(page);await page.getByRole('button',{name:'Review wallet ticket record',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('Locally verified mined transfer required');expect(calls).toEqual([])
})
async function removeHeaders(page:Page){await page.evaluate(()=>new Promise<void>((resolve,reject)=>{const r=indexedDB.open('counterfoil-spv-experiment-v1');r.onsuccess=()=>{const db=r.result,t=db.transaction('snapshots','readwrite');t.objectStore('snapshots').delete('accepted');t.oncomplete=()=>{db.close();resolve()};t.onabort=()=>reject(t.error)}}))}
test('changed saved headers discard an otherwise matching wallet result',async({page})=>{
 const f=await fixture();let route:Route|undefined;const {output}=await wallet(page,f,r=>{route=r});await mount(page,f)
 await page.getByRole('button',{name:'Review wallet ticket record',exact:true}).click();await expect.poll(()=>!!route).toBe(true)
 await removeHeaders(page);await route!.fulfill({json:{totalOutputs:1,outputs:[output]},headers:{'Access-Control-Allow-Origin':'*'}})
 await expect(page.getByRole('alert')).toContainText('Saved evidence or headers changed')
 await expect(page.getByText('Wallet record: present',{exact:true})).toHaveCount(0)
})
test('cancellation ends a stalled read and ignores its late response',async({page})=>{
 const f=await fixture();let route:Route|undefined;const {calls,output}=await wallet(page,f,r=>{route=r});await mount(page,f)
 await page.getByRole('button',{name:'Review wallet ticket record',exact:true}).click();await expect.poll(()=>!!route).toBe(true)
 await page.getByRole('button',{name:'Cancel wallet review'}).click();await expect(page.getByRole('alert')).toContainText('Wallet review cancelled')
 await route!.fulfill({json:{totalOutputs:1,outputs:[output]},headers:{'Access-Control-Allow-Origin':'*'}}).catch(()=>{})
 await expect(page.getByText('Wallet record: present',{exact:true})).toHaveCount(0);expect(calls.at(-1)).toBe('listOutputs')
})
