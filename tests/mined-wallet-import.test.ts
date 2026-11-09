import {afterEach,it,expect,vi} from 'vitest'
import {MerklePath,Utils} from '@bsv/sdk'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import * as spv from '../src/verification/signing-spv.ts'
import {reviewMinedImport,importMinedTicket,reconcileMinedImport,type ImportDependencies} from '../src/wallet/mined-import.ts'
import {newImportRecord,finishRecord,observationRecord,type ImportRecord} from '../src/wallet/import-journal.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
const snapshot=makeSnapshot([parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)])
async function setup(){
 const f=await ticketFixture();f.transfer.merklePath=new MerklePath(1,[[{offset:0,hash:'11'.repeat(32)},{offset:1,hash:f.pkg.current.txid,txid:true}]]);f.pkg.atomicBeefBase64=Utils.toBase64(f.transfer.toAtomicBEEF())
 const evidence={kind:'counterfoil-reopening-evidence' as const,version:1 as const,trusted:f.identity,pkg:f.pkg,buyer:f.destination}
 vi.spyOn(spv,'verifySigningEvidence').mockImplementation(async(_,s)=>{if(!s)throw new Error('Verification incomplete');return {txid:f.pkg.current.txid,anchors:[1],subjectMined:true,proofBytes:100,snapshotId:s.id}})
 const output={outpoint:`${f.pkg.current.txid}.0`,satoshis:1,spendable:true,lockingScript:f.transfer.outputs[0].lockingScript.toHex(),customInstructions:JSON.stringify({...f.destination.recipient,type:'PushDrop'})}
 let record:ImportRecord|undefined
 const wallet={getNetwork:async()=>({network:'testnet' as const}),getVersion:async()=>({version:'wallet-brc100-1.0.0'}),getPublicKey:f.wallet.getPublicKey.bind(f.wallet),listOutputs:vi.fn(async()=>({totalOutputs:0,outputs:[] as typeof output[]})),internalizeAction:vi.fn(async(_args:unknown)=>({accepted:true as const}))}
 const deps:ImportDependencies={source:async()=>({evidence,snapshot}),wallet:async()=>wallet,load:async()=>record,claim:async e=>{if(record)throw new Error('Already attempted');record=newImportRecord(e);return record},finish:async(_,id,outcome)=>{record=finishRecord(record!,id,outcome);return record},observe:async(_,id,review)=>{record=observationRecord(record!,id,review);return record}}
 return {evidence,wallet,output,deps,getRecord:()=>record}
}
afterEach(()=>vi.restoreAllMocks())
it('imports exact mined bytes and receiving instructions once after durable claim',async()=>{
 const t=await setup(),s=new AbortController().signal,review=await reviewMinedImport(t.evidence,s,t.deps)
 t.wallet.internalizeAction.mockImplementation(async()=>{expect(t.getRecord()?.attempt.outcome).toBe('pending');return {accepted:true}})
 const r=await importMinedTicket(review,s,t.deps);expect(r.attempt.outcome).toBe('accepted')
 expect(t.wallet.internalizeAction).toHaveBeenCalledWith({tx:Utils.toArray(t.evidence.pkg.atomicBeefBase64,'base64'),outputs:[{outputIndex:0,protocol:'basket insertion',insertionRemittance:{basket:'counterfoil-ticket-experiment',customInstructions:JSON.stringify({protocolID:t.evidence.buyer.recipient.protocolID,keyID:t.evidence.buyer.recipient.keyID,counterparty:'self',type:'PushDrop'})}}],description:'Import mined Counterfoil ticket',seekPermission:true})
 await expect(importMinedTicket(review,s,t.deps)).rejects.toThrow(/already|attempt/i);expect(t.wallet.internalizeAction).toHaveBeenCalledTimes(1)
})
it('storage claim failure prevents mutation',async()=>{
 const t=await setup(),s=new AbortController().signal,r=await reviewMinedImport(t.evidence,s,t.deps)
 t.deps.claim=async()=>{throw new Error('Storage unavailable')}
 await expect(importMinedTicket(r,s,t.deps)).rejects.toThrow(/Storage/);expect(t.wallet.internalizeAction).not.toHaveBeenCalled()
})
it('present, incomplete listing, missing proof and changed evidence prevent import',async()=>{
 const t=await setup(),s=new AbortController().signal,r=await reviewMinedImport(t.evidence,s,t.deps)
 t.wallet.listOutputs.mockResolvedValue({totalOutputs:1,outputs:[t.output]})
 await expect(importMinedTicket(r,s,t.deps)).rejects.toThrow(/absent/i)
 t.wallet.listOutputs.mockResolvedValue({totalOutputs:1,outputs:[]})
 await expect(importMinedTicket(r,s,t.deps)).rejects.toThrow(/absent/i)
 t.wallet.listOutputs.mockResolvedValue({totalOutputs:0,outputs:[]})
 t.deps.source=async()=>({evidence:t.evidence,snapshot:undefined})
 await expect(importMinedTicket(r,s,t.deps)).rejects.toThrow(/mined/i)
 t.deps.source=async()=>({evidence:{...t.evidence,buyer:{...t.evidence.buyer,requestId:'different',recipient:{...t.evidence.buyer.recipient,keyID:'different'}}},snapshot})
 await expect(importMinedTicket(r,s,t.deps)).rejects.toThrow(/changed/i)
 expect(t.wallet.internalizeAction).not.toHaveBeenCalled();expect(t.getRecord()).toBeUndefined()
})
it('lost response stays unknown after a matching read-only reconciliation',async()=>{
 const t=await setup(),s=new AbortController().signal,r=await reviewMinedImport(t.evidence,s,t.deps)
 t.wallet.internalizeAction.mockRejectedValue(new Error('connection lost'))
 expect((await importMinedTicket(r,s,t.deps)).attempt.outcome).toBe('unknown')
 t.wallet.listOutputs.mockResolvedValue({totalOutputs:1,outputs:[t.output]})
 const observed=await reconcileMinedImport(t.evidence,s,t.deps)
 expect(observed.attempt.outcome).toBe('unknown');expect(observed.observations.at(-1)?.state).toBe('present');expect(t.wallet.internalizeAction).toHaveBeenCalledTimes(1)
})
it('cancelling a dispatched import preserves uncertainty and ignores late acceptance',async()=>{
 const t=await setup(),c=new AbortController(),r=await reviewMinedImport(t.evidence,c.signal,t.deps)
 let release!:(v:{accepted:true})=>void;let started!:()=>void;const starting=new Promise<void>(resolve=>{started=resolve})
 t.wallet.internalizeAction.mockImplementation(()=>{started();return new Promise(resolve=>{release=resolve})})
 const run=importMinedTicket(r,c.signal,t.deps);await starting;c.abort(new Error('Cancelled'))
 expect((await run).attempt.outcome).toBe('unknown');release({accepted:true});await Promise.resolve();expect(t.getRecord()?.attempt.outcome).toBe('unknown')
})
it('failed final persistence retains pending protection and prevents another call',async()=>{
 const t=await setup(),s=new AbortController().signal,r=await reviewMinedImport(t.evidence,s,t.deps)
 t.deps.finish=async()=>{throw new Error('Storage failed after dispatch')}
 await expect(importMinedTicket(r,s,t.deps)).rejects.toThrow(/Storage/);expect(t.getRecord()?.attempt.outcome).toBe('pending')
 await expect(importMinedTicket(r,s,t.deps)).rejects.toThrow(/attempt/i);expect(t.wallet.internalizeAction).toHaveBeenCalledTimes(1)
})
it('cancellation after claim but before dispatch cannot send or enable retry',async()=>{
 const t=await setup(),c=new AbortController(),r=await reviewMinedImport(t.evidence,c.signal,t.deps),claim=t.deps.claim
 t.deps.claim=async e=>{const result=await claim(e);c.abort(new Error('Cancelled'));return result}
 expect((await importMinedTicket(r,c.signal,t.deps)).attempt.outcome).toBe('unknown');expect(t.wallet.internalizeAction).not.toHaveBeenCalled()
})
it('fresh pending attempts block reconciliation; accepted outcome cannot be rewritten',async()=>{
 const t=await setup(),pending=await t.deps.claim(t.evidence),s=new AbortController().signal
 await expect(reconcileMinedImport(t.evidence,s,t.deps)).rejects.toThrow(/60 seconds/)
 const finished=finishRecord(pending,pending.attempt.id,'accepted')
 expect(()=>finishRecord(finished,finished.attempt.id,'unknown')).toThrow(/final/i)
})
it('a wallet profile or network change during the journal claim stops dispatch',async()=>{
 const t=await setup(),s=new AbortController().signal,r=await reviewMinedImport(t.evidence,s,t.deps),claim=t.deps.claim
 t.deps.claim=async e=>{const result=await claim(e);t.wallet.getNetwork=async()=>({network:'mainnet' as 'testnet'});return result}
 expect((await importMinedTicket(r,s,t.deps)).attempt.outcome).toBe('unknown');expect(t.wallet.internalizeAction).not.toHaveBeenCalled()
})
it('evidence replaced while final public-key checks wait cannot be imported',async()=>{
 const t=await setup(),s=new AbortController().signal,r=await reviewMinedImport(t.evidence,s,t.deps),claim=t.deps.claim
 t.deps.claim=async e=>{const result=await claim(e),getKey=t.wallet.getPublicKey;let calls=0
  t.wallet.getPublicKey=async(...args)=>{const key=await getKey(...args);if(++calls===2)t.deps.source=async()=>({evidence:t.evidence,snapshot:undefined});return key};return result}
 expect((await importMinedTicket(r,s,t.deps)).attempt.outcome).toBe('unknown');expect(t.wallet.internalizeAction).not.toHaveBeenCalled()
})
it('failed reconciliation preserves an already accepted import response',async()=>{
 const t=await setup(),s=new AbortController().signal,r=await reviewMinedImport(t.evidence,s,t.deps)
 await importMinedTicket(r,s,t.deps);t.wallet.listOutputs.mockRejectedValue(new Error('wallet unavailable'))
 await expect(reconcileMinedImport(t.evidence,s,t.deps)).rejects.toThrow(/unavailable/)
 expect(t.getRecord()?.attempt.outcome).toBe('accepted');expect(t.wallet.internalizeAction).toHaveBeenCalledTimes(1)
})
