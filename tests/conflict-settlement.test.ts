import {afterEach,expect,it,vi} from 'vitest'
import {conflictFixture} from './helpers/conflict-fixture.ts'
import {reviewConflictSubmission,submitConflictBranch,checkConflictBranch} from '../src/conflicts/settlement.ts'
import {newConflictRun,type ConflictRecord} from '../src/conflicts/store.ts'
import * as spv from '../src/verification/signing-spv.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import h from './fixtures/headers/woc-1762324.json' with {type:'json'}
const snapshot=makeSnapshot([parseProviderHeader(h,'whatsonchain',h.height)]),signal=()=>new AbortController().signal
async function setup(){const f=await conflictFixture();const fees={} as NonNullable<ConflictRecord['keys']>['fees'];for(const b of ['a','b'] as const){const keyID=`fixture-fee-${b}`,protocolID:[2,string]=[2,'counterfoil conflict fees'];fees[b]={keyID,protocolID,counterparty:'self',publicKey:(await f.wallet.getPublicKey({protocolID,keyID,counterparty:'self',forSelf:true})).publicKey}}
 let r:ConflictRecord={...newConflictRun({trusted:f.trusted,eventId:'conflict-event',ticketId:'conflict-ticket'}),id:'fixture',keys:{source:f.source,a:f.a,b:f.b,fees},issued:{txid:f.base.current.txid,atomicBeefBase64:f.base.atomicBeefBase64},issuance:f.base,branches:f.pair}
 const deps={load:async()=>structuredClone(r),save:async(next:ConflictRecord,rev:number)=>{if(r.revision!==rev)throw new Error('stale');r=next},headers:async()=>snapshot,policy:vi.fn(async()=>({maxTxBytes:100000,feeSatoshis:1,feeBytes:1000})),status:vi.fn(async()=>undefined),post:vi.fn(async(_ef:string,id:string)=>({txid:id,txStatus:'RECEIVED',observedAt:new Date().toISOString()}))}
 vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:'',anchors:[1],subjectMined:false,proofBytes:1,snapshotId:snapshot.id})
 return {deps,run:()=>r}
}
afterEach(()=>vi.restoreAllMocks())
it('submits one explicitly reviewed branch with pending claim saved first',async()=>{
 const {deps,run}=await setup();deps.post.mockImplementation(async(_ef,id)=>{expect(run().attempts.at(-1)).toMatchObject({phase:'submit-a',outcome:'pending'});return {txid:id,txStatus:'RECEIVED',observedAt:new Date().toISOString()}})
 const reviewed=await reviewConflictSubmission(run(),'a',signal(),deps);await submitConflictBranch(reviewed,signal(),deps)
 expect(deps.post).toHaveBeenCalledTimes(1);expect(deps.post.mock.calls[0].slice(0,2)).toEqual([reviewed.transfer.efHex,reviewed.transfer.txid]);expect(run().observations.a?.at(-1)?.value?.txStatus).toBe('RECEIVED');expect(run().observations.b).toBeUndefined()
 await expect(submitConflictBranch(reviewed,signal(),deps)).rejects.toThrow();expect(deps.post).toHaveBeenCalledTimes(1)
})
it('lost response blocks retry and later status does not change the attempt',async()=>{
 const {deps,run}=await setup();deps.post.mockRejectedValue(new Error('lost'));const reviewed=await reviewConflictSubmission(run(),'a',signal(),deps);await submitConflictBranch(reviewed,signal(),deps)
 expect(run().attempts.at(-1)?.outcome).toBe('unknown');const saved=structuredClone(run().attempts)
 await checkConflictBranch(run(),'a',signal(),deps);expect(run().attempts).toEqual(saved)
 await expect(reviewConflictSubmission(run(),'a',signal(),deps)).rejects.toThrow();expect(deps.post).toHaveBeenCalledTimes(1)
})
it('changed source, policy or failed durable claim prevents POST',async()=>{
 const {deps,run}=await setup(),reviewed=await reviewConflictSubmission(run(),'a',signal(),deps)
 deps.policy.mockResolvedValue({maxTxBytes:1,feeSatoshis:1,feeBytes:1000});await expect(submitConflictBranch(reviewed,signal(),deps)).rejects.toThrow();expect(deps.post).not.toHaveBeenCalled()
 deps.policy.mockResolvedValue(reviewed.policy);deps.save=async()=>{throw new Error('storage')};await expect(submitConflictBranch(reviewed,signal(),deps)).rejects.toThrow('storage');expect(deps.post).not.toHaveBeenCalled()
})
