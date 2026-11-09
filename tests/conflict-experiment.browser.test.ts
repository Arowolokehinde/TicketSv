import {test,expect} from '@playwright/test'
test('conflict controls are inert and require local fixture review before wallet actions',async({page})=>{
 const requests:string[]=[];await page.route('http://localhost:3321/**',r=>{requests.push(r.request().url());return r.abort()})
 await page.goto('/dev/feasibility');const panel=page.getByRole('region',{name:'Controlled conflicting transfers.'})
 await expect(panel).toBeVisible();await expect(panel.getByRole('button',{name:'Issue and broadcast conflict fixture',exact:true})).toBeDisabled()
 await expect(panel.getByRole('button',{name:'Sign both conflict branches offline',exact:true})).toBeDisabled()
 expect(requests).toEqual([])
 await panel.getByText('Create a separate fixture record',{exact:true}).click()
 await panel.getByRole('button',{name:'Create separate local conflict record',exact:true}).click()
 await expect(panel.getByText('Separate local record saved. No wallet request made.',{exact:true})).toBeVisible()
 await page.reload();await expect(panel.getByRole('button',{name:'Issue and broadcast conflict fixture',exact:true})).toBeDisabled();expect(requests).toEqual([])
})

import {build} from 'vite'
import {resolve} from 'node:path'
import {readFile} from 'node:fs/promises'
import {PrivateKey,ProtoWallet,Transaction,LockingScript,UnlockingScript,MerklePath} from '@bsv/sdk'
import type {Page,Route} from '@playwright/test'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import h from './fixtures/headers/woc-1762324.json' with {type:'json'}
declare global {interface Window{ConflictTest:typeof import('./helpers/conflict-browser-entry.ts')}}
let bundle:string
const snapshot=makeSnapshot([parseProviderHeader(h,'whatsonchain',h.height)])
test.beforeAll(async()=>{
 const target=resolve('src/verification/signing-spv.ts'),built=await build({configFile:false,publicDir:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-conflict-anchors',async load(id){if(id===target){const s=await readFile(target,'utf8');return s.slice(0,s.indexOf('export async function verifySigningEvidence'))+`export async function verifySigningEvidence(e,s){if(!s)throw new Error('Verification incomplete');return {txid:e.txid,anchors:[1],subjectMined:!!Transaction.fromAtomicBEEF(e.atomicBeef).merklePath,proofBytes:e.atomicBeef.length,snapshotId:s.id}}`}}}],build:{write:false,minify:false,lib:{entry:resolve('tests/helpers/conflict-browser-entry.ts'),name:'ConflictTest',formats:['iife']}}})
 const o=Array.isArray(built)?built[0]:built;if(!('output' in o))throw new Error('bundle missing');bundle=o.output.filter(x=>x.type==='chunk').map(x=>x.code).join('\n')
})
async function mount(page:Page,seed=false){
 await page.route('**/conflict-test',r=>r.fulfill({body:'<!doctype html><div id="test-root"></div>',contentType:'text/html'}));await page.goto('/conflict-test');await page.addScriptTag({content:bundle})
 if(seed)await page.evaluate(async snapshot=>{for(const [name,store,key,value] of [['counterfoil-spv-experiment-v1','snapshots','accepted',snapshot],['counterfoil-wallet-import-v1','imports','existing-success',{sentinel:'accepted-success'}]] as const)await new Promise<void>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore(store);r.onsuccess=()=>{const db=r.result,t=db.transaction(store,'readwrite');t.objectStore(store).put(value,key);t.oncomplete=()=>{db.close();resolve()};t.onabort=()=>reject(t.error)}})},snapshot)
 await page.evaluate(()=>window.ConflictTest.render())
}
async function mockWallet(page:Page,mode:'normal'|'lost'|'hold'='normal'){
 const p=new ProtoWallet(new PrivateKey(45)),identity=(await p.getPublicKey({identityKey:true})).publicKey,calls:string[]=[];let issue:Transaction|undefined,held:Route|undefined
 await page.route('http://localhost:3321/**',async route=>{
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});return}
  const method=new URL(route.request().url()).pathname.split('/').at(-1)!,args=route.request().postDataJSON();calls.push(method);let result:unknown
  if(method==='getNetwork')result={network:'testnet'}
  else if(method==='getPublicKey')result=await p.getPublicKey(args)
  else if(method==='createSignature')result=await p.createSignature(args)
  else if(method==='createAction'){
   const funding=new Transaction(1,[],[{satoshis:10000,lockingScript:LockingScript.fromASM('OP_DROP OP_TRUE')}]);funding.merklePath=new MerklePath(1,[[{offset:1,hash:funding.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
   issue=new Transaction(1,[{sourceTransaction:funding,sourceOutputIndex:0,unlockingScript:UnlockingScript.fromASM('OP_TRUE')}],args.outputs.map((o:{satoshis:number;lockingScript:string})=>({satoshis:o.satoshis,lockingScript:LockingScript.fromHex(o.lockingScript)})))
   if(mode==='lost'){await route.abort('failed');return}if(mode==='hold'){held=route;return}
   result={txid:issue.id('hex'),tx:issue.toAtomicBEEF()}
  }else if(method==='listOutputs'){
   issue!.merklePath=new MerklePath(1,[[{offset:1,hash:issue!.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
   result={totalOutputs:1,outputs:[{outpoint:`${issue!.id('hex')}.0`,satoshis:1,spendable:true}],BEEF:issue!.toBEEF()}
  }else throw new Error('Unexpected wallet call '+method)
  await route.fulfill({json:result,headers:{'Access-Control-Allow-Origin':'*'}})
 });return {identity,calls,held:()=>held}
}
async function create(page:Page,identity:string){await page.getByText('Create a separate fixture record',{exact:true}).click();await page.getByLabel('Conflict venue identity',{exact:true}).fill(identity);await page.getByRole('button',{name:'Create separate local conflict record',exact:true}).click();await expect(page.getByText('Separate local record saved. No wallet request made.',{exact:true})).toBeVisible()}
const issue=(page:Page)=>page.getByRole('button',{name:'Issue and broadcast conflict fixture',exact:true})
async function startIssue(page:Page){await page.getByLabel('I authorize this NEW conflict fixture, its testnet issuance broadcast, funding and venue attestation.',{exact:true}).check();await issue(page).click()}
test('separate fixture signs both real synthetic branches and preserves existing import journal',async({page})=>{
 const w=await mockWallet(page);await mount(page,true);await create(page,w.identity);expect(w.calls).toEqual([]);await startIssue(page)
 await expect(page.getByText('Separate issuance and attestation saved. Wait for mining evidence before preparation.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Refresh conflict issuance mining evidence',exact:true}).click();await expect(page.getByText('Mining evidence saved. Download issuance SPV evidence and sync its headers above.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Prepare conflict branches for offline signing',exact:true}).click();await expect(page.getByText('Mined fixture verified and keys checked. Save all evidence and requests before disconnecting.',{exact:true})).toBeVisible()
 await page.getByLabel('I saved the fixture and both buyer requests, disabled external internet for app and wallet, and authorize signing both conflicting transfers.',{exact:true}).check()
 await page.getByRole('button',{name:'Sign both conflict branches offline',exact:true}).click();await expect(page.getByText('Both signed conflict branches saved locally. Neither branch was broadcast.',{exact:true})).toBeVisible()
 expect(w.calls.filter(x=>x==='createAction')).toHaveLength(1);expect(w.calls.filter(x=>x==='createSignature')).toHaveLength(5)
 const count=w.calls.length;await page.getByRole('button',{name:'Verify both branches locally',exact:true}).click();await expect(page.getByText('Pair verification: verified',{exact:true})).toBeVisible();expect(w.calls).toHaveLength(count)
 const saved=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('counterfoil-wallet-import-v1');r.onsuccess=()=>{const db=r.result,t=db.transaction('imports'),q=t.objectStore('imports').get('existing-success');t.oncomplete=()=>{db.close();resolve(q.result)}}}));expect(saved).toEqual({sentinel:'accepted-success'})
 await mount(page);await expect(issue(page)).toBeDisabled();await expect(page.getByRole('button',{name:'Sign both conflict branches offline',exact:true})).toBeDisabled();expect(w.calls).toHaveLength(count)
})
test('lost issuance response remains blocked after reload with no automatic retry',async({page})=>{
 const w=await mockWallet(page,'lost');await mount(page,true);await create(page,w.identity);await startIssue(page)
 await expect(page.getByText('issue: unknown',{exact:true})).toBeVisible();const count=w.calls.length
 await mount(page);await expect(issue(page)).toBeDisabled();await expect(page.getByText('issue: unknown',{exact:true})).toBeVisible();expect(w.calls).toHaveLength(count);expect(w.calls.filter(x=>x==='createAction')).toHaveLength(1)
})
test('two tabs can claim a fixture issuance only once',async({page,context})=>{
 const w=await mockWallet(page);await mount(page,true);await create(page,w.identity);const r=(await page.evaluate(()=>window.ConflictTest.listConflictRuns()))[0]
 const other=await context.newPage();await mount(other)
 const results=await Promise.all([page,other].map(p=>p.evaluate(async r=>{try{const claim=window.ConflictTest.claimConflictStep(r,'issue');await window.ConflictTest.updateConflictRun(claim,r.revision);return true}catch{return false}},r)))
 expect(results.filter(Boolean)).toHaveLength(1);await mount(page);await expect(issue(page)).toBeDisabled();expect(w.calls).toEqual([])
})
test('cancelling a dispatched issuance keeps uncertainty and blocks a late success',async({page})=>{
 const w=await mockWallet(page,'hold');await mount(page,true);await create(page,w.identity);await startIssue(page);await expect.poll(()=>!!w.held()).toBe(true)
 await page.getByRole('button',{name:'Cancel waiting for conflict operation',exact:true}).click();await expect(page.getByText('issue: unknown',{exact:true})).toBeVisible()
 await w.held()!.fulfill({json:{txid:'ab'.repeat(32),tx:[]},headers:{'Access-Control-Allow-Origin':'*'}}).catch(()=>{})
 await expect(issue(page)).toBeDisabled();await mount(page);await expect(issue(page)).toBeDisabled();expect(w.calls.filter(x=>x==='createAction')).toHaveLength(1)
})
test('submission requires branch consent, never sends B automatically and reload retains A attempt',async({page})=>{
 const w=await mockWallet(page);await mount(page,true);await create(page,w.identity);await startIssue(page)
 await expect(page.getByText('Separate issuance and attestation saved. Wait for mining evidence before preparation.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Refresh conflict issuance mining evidence',exact:true}).click();await expect(page.getByText('Mining evidence saved. Download issuance SPV evidence and sync its headers above.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Prepare conflict branches for offline signing',exact:true}).click();await expect(page.getByText('Mined fixture verified and keys checked. Save all evidence and requests before disconnecting.',{exact:true})).toBeVisible()
 await page.getByLabel('I saved the fixture and both buyer requests, disabled external internet for app and wallet, and authorize signing both conflicting transfers.',{exact:true}).check();await page.getByRole('button',{name:'Sign both conflict branches offline',exact:true}).click();await expect(page.getByText('Both signed conflict branches saved locally. Neither branch was broadcast.',{exact:true})).toBeVisible()
 const run=(await page.evaluate(()=>window.ConflictTest.listConflictRuns()))[0],posts:string[]=[]
 await page.route('https://arcade-v2-testnet-us-1.bsvblockchain.tech/**',async route=>{
  const req=route.request(),url=req.url(),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}
  if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers});return}
  if(url.endsWith('/policy')){await route.fulfill({json:{policy:{maxtxsizepolicy:100000,miningFee:{satoshis:1,bytes:1000}}},headers});return}
  if(req.method()==='POST'){posts.push(req.postData()!);await route.fulfill({json:{txid:run.branches.a!.pkg.current.txid,txStatus:'RECEIVED'},headers});return}
  await route.fulfill({status:404,body:'{}',headers})
 })
 const calls=w.calls.length
 await page.getByRole('button',{name:'Review branch A for submission',exact:true}).click();await expect(page.getByRole('button',{name:'Submit reviewed conflict branch',exact:true})).toBeDisabled();expect(posts).toEqual([])
 await page.getByLabel('I authorize publishing only this exact reviewed branch to testnet, spending its inputs and embedded fee.',{exact:true}).check();await page.getByRole('button',{name:'Submit reviewed conflict branch',exact:true}).click()
 await expect(page.getByText('Branch A submission complete. Check status; this is not verified settlement.',{exact:true})).toBeVisible();expect(posts).toHaveLength(1);expect(w.calls).toHaveLength(calls)
 await mount(page);await expect(page.getByRole('button',{name:'Review branch A for submission',exact:true})).toBeDisabled();expect(posts).toHaveLength(1)
 const after=(await page.evaluate(()=>window.ConflictTest.listConflictRuns()))[0];expect(after.attempts.filter(a=>a.phase.startsWith('submit-'))).toHaveLength(1);expect(after.observations.b).toBeUndefined()
})
test('local verification rejects an obsolete tab record after another tab updates the run',async({page})=>{
 const w=await mockWallet(page);await mount(page,true);await create(page,w.identity);await startIssue(page)
 await expect(page.getByText('Separate issuance and attestation saved. Wait for mining evidence before preparation.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Refresh conflict issuance mining evidence',exact:true}).click();await expect(page.getByText('Mining evidence saved. Download issuance SPV evidence and sync its headers above.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Prepare conflict branches for offline signing',exact:true}).click();await expect(page.getByText('Mined fixture verified and keys checked. Save all evidence and requests before disconnecting.',{exact:true})).toBeVisible()
 await page.getByLabel('I saved the fixture and both buyer requests, disabled external internet for app and wallet, and authorize signing both conflicting transfers.',{exact:true}).check();await page.getByRole('button',{name:'Sign both conflict branches offline',exact:true}).click();await expect(page.getByText('Both signed conflict branches saved locally. Neither branch was broadcast.',{exact:true})).toBeVisible()
 await page.evaluate(async()=>{const r=(await window.ConflictTest.listConflictRuns())[0];await window.ConflictTest.updateConflictRun({...r,revision:r.revision+1,observations:{a:[{checkedAt:new Date().toISOString(),value:{txid:r.branches.a!.pkg.current.txid,txStatus:'MINED_IN_STALE_BLOCK',observedAt:new Date().toISOString()}}]}},r.revision)})
 await page.getByRole('button',{name:'Verify both branches locally',exact:true}).click()
 await expect(page.getByText('Pair verification: verified',{exact:true})).not.toBeVisible();await expect(page.getByRole('alert')).toContainText('changed')
})
