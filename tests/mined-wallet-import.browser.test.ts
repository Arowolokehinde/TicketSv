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
declare global{interface Window{MinedImportTest:typeof import('./helpers/mined-import-browser-entry.ts')}}
const snapshot=makeSnapshot([parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)])
let bundle:string
// Synthetic SPV boundary only. Ticket crypto, production UI, SDK HTTP transport,
// IndexedDB claim and response reconciliation are real. No live wallet calls.
test.beforeAll(async()=>{
 const target=resolve('src/verification/signing-spv.ts')
 const built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-spv-boundary',async load(id){
  if(id===target){const source=await readFile(target,'utf8');return source.slice(0,source.indexOf('export async function verifySigningEvidence'))+`export async function verifySigningEvidence(evidence,snapshot){if(!snapshot)throw new Error('Verification incomplete');return {txid:evidence.txid,anchors:[1],subjectMined:!!Transaction.fromAtomicBEEF(evidence.atomicBeef).merklePath,proofBytes:evidence.atomicBeef.length,snapshotId:snapshot.id}}`}
 }}],build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/mined-import-browser-entry.ts'),name:'MinedImportTest',formats:['iife']}}})
 const output=Array.isArray(built)?built[0]:built;if(!('output' in output))throw new Error('Missing bundle');bundle=output.output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n')
})
async function fixture(){
 const f=await ticketFixture();f.issue.merklePath=new MerklePath(1,[[{offset:0,hash:'11'.repeat(32)},{offset:1,hash:f.issue.id('hex'),txid:true}]])
 const evidence:ReopeningEvidence={kind:'counterfoil-reopening-evidence',version:1,trusted:f.identity,pkg:{...f.pkg,atomicBeefBase64:Utils.toBase64(f.transfer.toAtomicBEEF())},buyer:f.destination}
 f.transfer.merklePath=new MerklePath(b.height,[[{offset:0,hash:'22'.repeat(32)},{offset:1,hash:f.transfer.id('hex'),txid:true}]])
 return {evidence,candidate:{...evidence,pkg:{...evidence.pkg,atomicBeefBase64:Utils.toBase64(f.transfer.toAtomicBEEF())}}}
}
async function mount(page:Page,f?:Awaited<ReturnType<typeof fixture>>){
 await page.route('**/mined-import-test',r=>r.fulfill({body:'<!doctype html><div id="test-root"></div>',contentType:'text/html'}))
 await page.goto('/mined-import-test');await page.addScriptTag({content:bundle})
 if(f)await page.evaluate(async({f,snapshot})=>{
  for(const [name,store,key,value] of [['counterfoil-reopening-evidence-v1','evidence','current',f.evidence],['counterfoil-spv-experiment-v1','snapshots','accepted',snapshot]] as const){await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction(store,'readwrite');t.objectStore(store).put(value,key);t.oncomplete=()=>{db.close();resolve()};t.onabort=()=>reject(t.error)}})}
  const old=await window.MinedImportTest.ensureSettlement(f.evidence);await window.MinedImportTest.saveSettlement({...old,revision:old.revision+1,candidate:f.candidate},old.revision)
 },{f,snapshot})
 await page.evaluate(()=>window.MinedImportTest.render())
}
async function wallet(page:Page,f:Awaited<ReturnType<typeof fixture>>,mode:'normal'|'lost'|'lost-absent'|'hold'='normal'){
 const calls:string[]=[],args:unknown[]=[],tx=Transaction.fromAtomicBEEF(Utils.toArray(f.candidate.pkg.atomicBeefBase64,'base64')),key=f.evidence.buyer.recipient
 const output={outpoint:`${f.evidence.pkg.current.txid}.0`,satoshis:1,spendable:true,lockingScript:tx.outputs[0].lockingScript.toHex(),customInstructions:JSON.stringify({type:'PushDrop',protocolID:key.protocolID,keyID:key.keyID,counterparty:key.counterparty})}
 let owned=false,held:Route|undefined
 await page.route('http://localhost:3321/**',async r=>{
  if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return}
  const method=new URL(r.request().url()).pathname.split('/').at(-1)!,body=r.request().postDataJSON();calls.push(method)
  if(method==='internalizeAction'){args.push(body);owned=mode!=='lost-absent';if(mode==='lost'||mode==='lost-absent'){await r.abort('failed');return}if(mode==='hold'){held=r;return}}
  const results:Record<string,unknown>={getNetwork:{network:'testnet'},getVersion:{version:'wallet-brc100-1.0.0'},getPublicKey:{publicKey:body.identityKey?f.evidence.trusted:key.publicKey},listOutputs:{totalOutputs:owned?1:0,outputs:owned?[output]:[]},internalizeAction:{accepted:true}}
  if(!(method in results))throw new Error('Unexpected wallet mutation '+method)
  await r.fulfill({json:results[method],headers:{'Access-Control-Allow-Origin':'*'}})
 });return {calls,args,held:()=>held}
}
const review=(p:Page)=>p.getByRole('button',{name:'Review mined ticket for import',exact:true})
const submit=(p:Page)=>p.getByRole('button',{name:'Import reviewed mined ticket',exact:true})
async function consent(page:Page){await review(page).click();await expect(page.getByText('Import review ready.',{exact:true})).toBeVisible();await page.getByRole('checkbox').check()}
test('production import controls are inert without evidence and consent',async({page})=>{
 const calls:string[]=[];await page.route('http://localhost:3321/**',r=>{calls.push(r.request().url());return r.abort()});await page.goto('/dev/feasibility')
 const panel=page.getByRole('region',{name:'Import mined ticket.'});await expect(submit(panel as unknown as Page)).toBeDisabled();expect(calls).toEqual([])
})
test('explicit import persists acceptance, checks output, and reload never reimports',async({page})=>{
 const f=await fixture(),w=await wallet(page,f);await mount(page,f);await expect(review(page)).toBeEnabled();expect(w.calls).toEqual([])
 await review(page).click();await expect(submit(page)).toBeDisabled();await page.getByRole('checkbox').check();await submit(page).click()
 await expect(page.getByText('Import response: accepted',{exact:true})).toBeVisible();await expect(page.getByText('Latest wallet observation: present',{exact:true})).toBeVisible()
 expect(w.args).toHaveLength(1);expect(w.args[0]).toMatchObject({outputs:[{outputIndex:0,protocol:'basket insertion',insertionRemittance:{basket:'counterfoil-ticket-experiment'}}]})
 const record=await page.evaluate(id=>window.MinedImportTest.loadImport(id),f.evidence.pkg.current.txid);expect(record?.evidence).toEqual(f.candidate)
 const count=w.calls.length;await mount(page);await expect(page.getByText('Import response: accepted',{exact:true})).toBeVisible();expect(w.calls).toHaveLength(count);await expect(submit(page)).toBeDisabled()
})
// Catches lost durable uncertainty on reload, reconciliation promoting an unknown
// response to accepted, and absence accidentally enabling a second mutation.
for(const state of ['present','absent'] as const)test(`lost response survives reload and ${state} reconciliation never retries import`,async({page})=>{
 const f=await fixture(),w=await wallet(page,f,state==='present'?'lost':'lost-absent');await mount(page,f);await consent(page);await submit(page).click()
 await expect(page.getByText('Import response: unknown',{exact:true})).toBeVisible()
 const before=await page.evaluate(id=>window.MinedImportTest.loadImport(id),f.evidence.pkg.current.txid)
 expect(before?.attempt.outcome).toBe('unknown');expect(before?.observations).toEqual([])
 const callsBeforeReload=w.calls.length;await mount(page)
 await expect(page.getByText('Import response: unknown',{exact:true})).toBeVisible();expect(w.calls).toHaveLength(callsBeforeReload)
 await expect(review(page)).toBeDisabled();await expect(submit(page)).toBeDisabled()
 const firstRead=w.calls.length
 await page.getByRole('button',{name:'Reconcile wallet import',exact:true}).click()
 await expect(page.getByText(`Latest wallet observation: ${state}`,{exact:true})).toBeVisible()
 await expect(page.getByText('Import response: unknown',{exact:true})).toBeVisible();await expect(submit(page)).toBeDisabled()
 expect(w.args).toHaveLength(1)
 const reconciliationCalls=w.calls.slice(firstRead)
 expect(reconciliationCalls).toContain('listOutputs')
 expect(reconciliationCalls.every(method=>['getNetwork','getPublicKey','getVersion','listOutputs'].includes(method))).toBe(true)
 const after=await page.evaluate(id=>window.MinedImportTest.loadImport(id),f.evidence.pkg.current.txid)
 expect(after?.attempt).toEqual(before?.attempt);expect(after?.evidence).toEqual(before?.evidence)
 expect(after?.observations).toHaveLength(1);expect(after?.observations[0].state).toBe(state)
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download wallet import diagnostic',exact:true}).click()
 const path=await (await downloaded).path();expect(path).toBeTruthy()
 expect(JSON.parse(await readFile(path!,'utf8'))).toEqual({kind:'counterfoil-wallet-import-diagnostic',record:after})
 const callsAfterRead=w.calls.length;await mount(page)
 await expect(page.getByText(`Latest wallet observation: ${state}`,{exact:true})).toBeVisible()
 await expect(page.getByText('Import response: unknown',{exact:true})).toBeVisible();await expect(submit(page)).toBeDisabled()
 expect(w.calls).toHaveLength(callsAfterRead);expect(w.args).toHaveLength(1)
})
test('two tabs can claim only one durable attempt and reload preserves pending block',async({page,context})=>{
 const f=await fixture();await mount(page,f);const other=await context.newPage();await mount(other)
 const outcomes=await Promise.all([page,other].map(p=>p.evaluate(async e=>{try{await window.MinedImportTest.claimImport(e);return true}catch{return false}},f.candidate)))
 expect(outcomes.filter(Boolean)).toHaveLength(1);await mount(page);await expect(page.getByText('Import response: pending',{exact:true})).toBeVisible();await expect(submit(page)).toBeDisabled()
})
test('blocked journal write prevents wallet mutation',async({page})=>{
 const f=await fixture(),w=await wallet(page,f);await mount(page,f);await consent(page)
 await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args:Parameters<typeof original>){if(this.name==='counterfoil-wallet-import-v1'&&args[1]==='readwrite')throw new Error('Simulated import storage failure');return original.apply(this,args)}})
 await submit(page).click();await expect(page.getByRole('alert')).toContainText('storage failure');expect(w.args).toHaveLength(0)
})
test('timeout retains uncertainty and a late wallet response cannot enable retry',async({page})=>{
 const f=await fixture(),w=await wallet(page,f,'hold');await mount(page,f);await consent(page);await page.clock.install();await submit(page).click();await expect.poll(()=>!!w.held()).toBe(true)
 await page.clock.fastForward(31000);await expect(page.getByText('Import response: unknown',{exact:true})).toBeVisible();await w.held()!.fulfill({json:{accepted:true},headers:{'Access-Control-Allow-Origin':'*'}}).catch(()=>{})
 await expect(submit(page)).toBeDisabled();expect(w.args).toHaveLength(1)
})
test('headers removed after review prevent claim and import',async({page})=>{
 const f=await fixture(),w=await wallet(page,f);await mount(page,f);await consent(page)
 await page.evaluate(()=>new Promise<void>(resolve=>{const r=indexedDB.open('counterfoil-spv-experiment-v1');r.onsuccess=()=>{const db=r.result,t=db.transaction('snapshots','readwrite');t.objectStore('snapshots').delete('accepted');t.oncomplete=()=>{db.close();resolve()}}}))
 await submit(page).click();await expect(page.getByRole('alert')).toContainText('mined transfer required');expect(w.args).toHaveLength(0)
 expect(await page.evaluate(id=>window.MinedImportTest.loadImport(id),f.evidence.pkg.current.txid)).toBeUndefined()
})
