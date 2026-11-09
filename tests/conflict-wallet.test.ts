import {afterEach,expect,it,vi} from 'vitest'
import {PrivateKey,ProtoWallet,Transaction,MerklePath,Utils,LockingScript,UnlockingScript} from '@bsv/sdk'
import type {WalletInterface} from '@bsv/sdk'
import {newConflictRun,readConflictRun,claimConflictStep,finishConflictStep,type ConflictRecord} from '../src/conflicts/store.ts'
import {issueConflictFixture,prepareConflictSigning,signConflictBranches} from '../src/wallet/conflict-experiment.ts'
import * as spv from '../src/verification/signing-spv.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import h from './fixtures/headers/woc-1762324.json' with {type:'json'}
function fundingInputs(){const tx=new Transaction(1,[],[{satoshis:10000,lockingScript:LockingScript.fromASM('OP_DROP OP_TRUE')}]);tx.merklePath=new MerklePath(1,[[{offset:1,hash:tx.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]]);return [{sourceTransaction:tx,sourceOutputIndex:0,unlockingScript:UnlockingScript.fromASM('OP_TRUE')}] }
const snapshot=makeSnapshot([parseProviderHeader(h,'whatsonchain',h.height)]),signal=()=>new AbortController().signal
function memory(record:ConflictRecord){let value=record;return {load:async()=>structuredClone(value),save:async(next:ConflictRecord,revision:number)=>{if(value.revision!==revision)throw new Error('stale');value=readConflictRun(next)},current:()=>value}}
async function fixture(){
 const p=new ProtoWallet(new PrivateKey(45)),trusted=(await p.getPublicKey({identityKey:true})).publicKey
 const record=newConflictRun({trusted,eventId:'conflict-event',ticketId:'test-ticket'}),store=memory(record)
 const create=vi.fn(async(args:Parameters<WalletInterface['createAction']>[0])=>{
  const {LockingScript}=await import('@bsv/sdk');const tx=new Transaction(1,fundingInputs(),args.outputs!.map(o=>({satoshis:o.satoshis,lockingScript:LockingScript.fromHex(o.lockingScript)})))
  return {txid:tx.id('hex'),tx:tx.toAtomicBEEF()}
 })
 const signature=vi.fn(p.createSignature.bind(p))
 const wallet={getNetwork:async()=>({network:'testnet'}),getPublicKey:p.getPublicKey.bind(p),createSignature:signature,createAction:create} as unknown as WalletInterface
 return {wallet,create,signature,record,store}
}
async function mined(){const f=await fixture();await issueConflictFixture(f.wallet,f.record,signal(),f.store)
 const r=f.store.current(),tx=Transaction.fromAtomicBEEF(Utils.toArray(r.issuance!.atomicBeefBase64,'base64'))
 tx.merklePath=new MerklePath(1,[[{offset:1,hash:tx.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
 const next={...r,revision:r.revision+1,issuance:{...r.issuance!,atomicBeefBase64:Utils.toBase64(tx.toAtomicBEEF())}}
 await f.store.save(next,r.revision)
 vi.spyOn(spv,'verifySigningEvidence').mockImplementation(async e=>({txid:e.txid,anchors:[1],subjectMined:!!Transaction.fromAtomicBEEF([...e.atomicBeef]).merklePath,proofBytes:e.atomicBeef.length,snapshotId:snapshot.id}))
 return f
}
afterEach(()=>vi.restoreAllMocks())
it('claims cannot repeat and final/unknown states survive strict decoding',()=>{
 const r=newConflictRun({trusted:new PrivateKey(42).toPublicKey().toString(),eventId:'e',ticketId:'t'})
 const claim=claimConflictStep(r,'issue');expect(()=>claimConflictStep(claim,'issue')).toThrow()
 const done=finishConflictStep(claim,'issue','unknown');expect(readConflictRun(done).attempts[0].outcome).toBe('unknown')
 expect(()=>claimConflictStep(done,'issue')).toThrow();expect(()=>claimConflictStep(done,'sign-a')).toThrow()
 expect(()=>readConflictRun({...done,version:2})).toThrow()
})
it('issuance claims before broadcast and creates only the reviewed dedicated outputs',async()=>{
 const f=await fixture();f.create.mockImplementationOnce(async args=>{expect(f.store.current().attempts.at(-1)).toMatchObject({phase:'issue',outcome:'pending'});const {LockingScript}=await import('@bsv/sdk');const tx=new Transaction(1,fundingInputs(),args.outputs!.map(o=>({satoshis:o.satoshis,lockingScript:LockingScript.fromHex(o.lockingScript)})));return {txid:tx.id('hex'),tx:tx.toAtomicBEEF()}})
 await issueConflictFixture(f.wallet,f.record,signal(),f.store)
 expect(f.create.mock.calls[0][0]).toMatchObject({options:{noSend:false,acceptDelayedBroadcast:false,randomizeOutputs:false},outputs:[{satoshis:1,basket:'counterfoil-conflict-ticket'},{satoshis:1000,basket:'counterfoil-conflict-fees'},{satoshis:1000,basket:'counterfoil-conflict-fees'}]})
 expect(f.store.current().issuance?.lineageRawTxs).toHaveLength(1);expect(f.signature).toHaveBeenCalledTimes(1)
 await expect(issueConflictFixture(f.wallet,f.store.current(),signal(),f.store)).rejects.toThrow();expect(f.create).toHaveBeenCalledTimes(1)
})
it('a storage failure before claim prevents any funding action',async()=>{
 const f=await fixture();await expect(issueConflictFixture(f.wallet,f.record,signal(),{...f.store,save:async()=>{throw new Error('disk')}})).rejects.toThrow('disk');expect(f.create).not.toHaveBeenCalled()
})
it('lost issuance response remains unknown and cannot be retried',async()=>{
 const f=await fixture();f.create.mockRejectedValue(new Error('response lost'));await expect(issueConflictFixture(f.wallet,f.record,signal(),f.store)).rejects.toThrow()
 expect(f.store.current().attempts[0].outcome).toBe('unknown');await expect(issueConflictFixture(f.wallet,f.store.current(),signal(),f.store)).rejects.toThrow();expect(f.create).toHaveBeenCalledTimes(1)
})
it('builds both conflicts using four real wallet signatures and no more createAction calls',async()=>{
 const f=await mined();const prepared=await prepareConflictSigning(f.wallet,f.store.current(),snapshot,signal())
 const count=f.signature.mock.calls.length;await signConflictBranches(f.wallet,prepared,signal(),f.store,async()=>snapshot)
 expect(f.signature.mock.calls.length-count).toBe(4);expect(f.create).toHaveBeenCalledTimes(1)
 const r=f.store.current();expect(r.branches.a).toBeDefined();expect(r.branches.b).toBeDefined()
 const txs=[r.branches.a!,r.branches.b!].map(e=>Transaction.fromAtomicBEEF(Utils.toArray(e.pkg.atomicBeefBase64,'base64')))
 expect(txs[0].inputs.map(i=>i.sourceOutputIndex)).toEqual([0,1]);expect(txs[1].inputs.map(i=>i.sourceOutputIndex)).toEqual([0,2])
 expect(await txs[0].verify('scripts only')).toBe(true);expect(await txs[1].verify('scripts only')).toBe(true)
})
it('header changes and profile switches stop signing before any signature',async()=>{
 const f=await mined(),p=await prepareConflictSigning(f.wallet,f.store.current(),snapshot,signal()),count=f.signature.mock.calls.length
 await expect(signConflictBranches(f.wallet,p,signal(),f.store,async()=>undefined)).rejects.toThrow();expect(f.signature).toHaveBeenCalledTimes(count)
 f.wallet.getNetwork=async()=>({network:'mainnet'});await expect(signConflictBranches(f.wallet,p,signal(),f.store,async()=>snapshot)).rejects.toThrow();expect(f.signature).toHaveBeenCalledTimes(count)
})
it('partial signing preserves A and an uncertain B, never exports partial B or retries',async()=>{
 const f=await mined(),p=await prepareConflictSigning(f.wallet,f.store.current(),snapshot,signal());const old=f.wallet.createSignature.bind(f.wallet);let n=0
 f.wallet.createSignature=async args=>{if(++n===3)throw new Error('lost B signature');return old(args)}
 await expect(signConflictBranches(f.wallet,p,signal(),f.store,async()=>snapshot)).rejects.toThrow()
 expect(f.store.current().branches.a).toBeDefined();expect(f.store.current().branches.b).toBeUndefined();expect(f.store.current().attempts.at(-1)).toMatchObject({phase:'sign-b',outcome:'unknown'})
 await expect(signConflictBranches(f.wallet,p,signal(),f.store,async()=>snapshot)).rejects.toThrow();expect(n).toBe(3)
})
it('persists a returned issuance reference before subsequent wallet reads can stall',async()=>{
 const f=await fixture();let afterCreate=false
 const originalCreate=f.wallet.createAction.bind(f.wallet);f.wallet.createAction=async args=>{const result=await originalCreate(args);afterCreate=true;return result}
 f.wallet.getNetwork=async()=>{if(afterCreate){expect(f.store.current().attempts.at(-1)?.reference).toMatch(/^[0-9a-f]{64}$/);expect(f.store.current().attempts.at(-1)?.returned?.atomicBeefBase64).toBeTruthy();throw new Error('subsequent read failed')}return {network:'testnet'}}
 await expect(issueConflictFixture(f.wallet,f.record,signal(),f.store)).rejects.toThrow('subsequent read failed')
 expect(f.store.current().attempts.at(-1)?.outcome).toBe('unknown')
})
