import {it,expect,vi,afterEach} from 'vitest'
import {MerklePath,Utils} from '@bsv/sdk'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import {transactionSummary} from '../src/settlement/evidence.ts'
import {submitReviewedTransfer,reconcileSettlement} from '../src/settlement/coordinator.ts'
import {readSettlement,nextClaim} from '../src/settlement/store.ts'
import type {SettlementRecord,TransferReview} from '../src/settlement/types.ts'
async function setup(){
 const f=await ticketFixture();f.issue.merklePath=new MerklePath(1,[[{offset:0,hash:'11'.repeat(32)},{offset:1,hash:f.issue.id('hex'),txid:true}]]);f.pkg.atomicBeefBase64=Utils.toBase64(f.transfer.toAtomicBEEF())
 const review:TransferReview={...transactionSummary({kind:'counterfoil-reopening-evidence',version:1,trusted:f.identity,pkg:f.pkg,buyer:f.destination}),snapshotId:'ab'.repeat(32)}
 let record:SettlementRecord|undefined
 const post=vi.fn(async()=>({txid:review.txid,txStatus:'SEEN_ON_NETWORK',observedAt:new Date().toISOString()}))
 const deps={review:async()=>structuredClone(review),policy:async()=>({maxTxBytes:1000000,feeBytes:1000,feeSatoshis:0}),post,
  claim:async(r:TransferReview,revision:number|undefined,retry:boolean)=>{record=nextClaim(record,r,revision,retry);return structuredClone(record)},
  save:async(next:SettlementRecord,revision:number)=>{if(record?.revision!==revision)throw new Error('stale');record=readSettlement(next)},
  status:async()=>undefined}
 return {review,deps,post,get:()=>record}
}
afterEach(()=>vi.restoreAllMocks())
it('commits the attempt before dispatch and retains the exact signed bytes',async()=>{
 const t=await setup();t.post.mockImplementation(async()=>{expect(t.get()?.attempts[0].outcome).toBe('pending');return {txid:t.review.txid,txStatus:'SEEN_ON_NETWORK',observedAt:new Date().toISOString()}})
 const r=await submitReviewedTransfer(t.review,undefined,new AbortController().signal,false,t.deps)
 expect(r.attempts[0].outcome).toBe('response');expect(r.lastStatus?.txStatus).toBe('SEEN_ON_NETWORK');expect(r.rawHex).toBe(t.review.rawHex)
 expect(t.post).toHaveBeenCalledExactlyOnceWith(t.review.efHex,t.review.txid,expect.any(AbortSignal))
 await expect(submitReviewedTransfer(t.review,r.revision,new AbortController().signal,true,t.deps)).rejects.toThrow();expect(t.post).toHaveBeenCalledTimes(1)
})
it('a lost response remains unknown; explicit GET reconciliation and acknowledgement precede identical retries',async()=>{
 const t=await setup();t.post.mockRejectedValue(new Error('lost response'))
 const first=await submitReviewedTransfer(t.review,undefined,new AbortController().signal,false,t.deps)
 expect(first.attempts[0].outcome).toBe('unknown');expect(t.post).toHaveBeenCalledTimes(1)
 await expect(submitReviewedTransfer(t.review,first.revision,new AbortController().signal,true,t.deps)).rejects.toThrow(/status/i)
 let r=await reconcileSettlement(first,new AbortController().signal,t.deps)
 expect(r.lastStatus).toBeUndefined();expect(r.attempts[0].outcome).toBe('unknown')
 await expect(submitReviewedTransfer(t.review,r.revision,new AbortController().signal,false,t.deps)).rejects.toThrow(/acknowledge/i)
 for(let n=2;n<=3;n++){r=await submitReviewedTransfer(t.review,r.revision,new AbortController().signal,true,t.deps);expect(r.attempts).toHaveLength(n);r=await reconcileSettlement(r,new AbortController().signal,t.deps)}
 await expect(submitReviewedTransfer(t.review,r.revision,new AbortController().signal,true,t.deps)).rejects.toThrow(/limit/i)
 expect(t.post).toHaveBeenCalledTimes(3)
})
it('storage failure, stale evidence and cancellation before dispatch do not submit',async()=>{
 const t=await setup(),c=new AbortController()
 await expect(submitReviewedTransfer(t.review,undefined,c.signal,false,{...t.deps,claim:async()=>{throw new Error('storage failed')}})).rejects.toThrow(/storage/)
 await expect(submitReviewedTransfer({...t.review,rawHex:'00'},undefined,c.signal,false,t.deps)).rejects.toThrow(/changed/)
 c.abort();await expect(submitReviewedTransfer(t.review,undefined,c.signal,false,t.deps)).rejects.toThrow();expect(t.post).not.toHaveBeenCalled()
})
it('lost final persistence leaves the pending claim rather than declaring completion',async()=>{
 const t=await setup()
 await expect(submitReviewedTransfer(t.review,undefined,new AbortController().signal,false,{...t.deps,save:async()=>{throw new Error('storage failed')}})).rejects.toThrow(/unknown/i)
 expect(t.get()?.attempts[0].outcome).toBe('pending');expect(t.post).toHaveBeenCalledTimes(1)
})
it('rejects conflicting bodies, malformed stored records and wrong response txids',async()=>{
 const t=await setup();t.post.mockResolvedValue({txid:'00'.repeat(32),txStatus:'MINED',observedAt:new Date().toISOString()})
 const r=await submitReviewedTransfer(t.review,undefined,new AbortController().signal,false,t.deps)
 expect(r.attempts[0].outcome).toBe('unknown')
 expect(()=>readSettlement({...r,rawHex:'00'})).toThrow()
 expect(()=>nextClaim(r,{...t.review,efHex:'00'},r.revision,true)).toThrow()
 expect(()=>readSettlement({...r,provider:'https://other.example'})).toThrow()
})
it('a second tab cannot authorize a retry while the first submission is still pending',async()=>{
 const t=await setup(),pending=nextClaim(undefined,t.review,undefined)
 const forgedReconciled={...pending,reconciledAttemptId:pending.attempts[0].id,lastStatusCheckedAt:new Date().toISOString()}
 expect(()=>nextClaim(forgedReconciled,t.review,pending.revision,true)).toThrow(/progress|wait/i)
 const status=vi.fn(async()=>undefined)
 await expect(reconcileSettlement(pending,new AbortController().signal,{...t.deps,status})).rejects.toThrow(/progress|wait/i)
 expect(status).not.toHaveBeenCalled()
})
it('changes during the policy request invalidate consent before a claim is saved',async()=>{
 const t=await setup();let changed=false
 const deps={...t.deps,policy:async()=>{changed=true;return {maxTxBytes:1000000,feeBytes:1000,feeSatoshis:0}},review:async()=>changed?{...t.review,snapshotId:'cd'.repeat(32)}:t.review}
 await expect(submitReviewedTransfer(t.review,undefined,new AbortController().signal,false,deps)).rejects.toThrow(/changed/i)
 expect(t.get()).toBeUndefined();expect(t.post).not.toHaveBeenCalled()
})
it('known POST or GET statuses permanently block retries even after 404 or UNKNOWN',async()=>{
 for(const txStatus of ['REJECTED','DOUBLE_SPEND_ATTEMPTED','SEEN_ON_NETWORK','MINED_IN_STALE_BLOCK','MINED']){
  for(const via of ['post','get']){
   const t=await setup(),s=new AbortController().signal
   if(via==='post')t.post.mockResolvedValue({txid:t.review.txid,txStatus,observedAt:new Date().toISOString()})
   else t.post.mockRejectedValue(new Error('lost'))
   let r=await submitReviewedTransfer(t.review,undefined,s,false,t.deps)
   if(via==='get')r=await reconcileSettlement(r,s,{...t.deps,status:async()=>({txid:r.txid,txStatus,observedAt:new Date().toISOString()})})
   r=await reconcileSettlement(r,s,t.deps)
   expect(()=>nextClaim(r,t.review,r.revision,true)).toThrow(/status|review/i)
   r=await reconcileSettlement(r,s,{...t.deps,status:async()=>({txid:r.txid,txStatus:'UNKNOWN',observedAt:new Date().toISOString()})})
   expect(()=>nextClaim(r,t.review,r.revision,true)).toThrow(/status|review/i)
  }
 }
})
it('retains bounded status evidence including mining proof and not-found checks',async()=>{
 const t=await setup(),s=new AbortController().signal;t.post.mockRejectedValue(new Error('lost'))
 let r=await submitReviewedTransfer(t.review,undefined,s,false,t.deps)
 const mined={txid:r.txid,txStatus:'MINED',blockHash:'ab'.repeat(32),blockHeight:1,merklePath:'abcd',observedAt:new Date().toISOString()}
 r=await reconcileSettlement(r,s,{...t.deps,status:async()=>mined})
 r=await reconcileSettlement(r,s,{...t.deps,status:async()=>({...mined,txStatus:'MINED_IN_STALE_BLOCK'})})
 r=await reconcileSettlement(r,s,t.deps)
 expect(r).toMatchObject({statusChecks:[{observation:{txStatus:'MINED',merklePath:'abcd'}},{observation:{txStatus:'MINED_IN_STALE_BLOCK'}},{observation:undefined}]})
 // Even after old bounded diagnostics roll off, the retry prohibition survives.
 for(let i=0;i<35;i++)r=await reconcileSettlement(r,s,t.deps)
 expect((r as unknown as {statusChecks:unknown[]}).statusChecks).toHaveLength(32)
 expect(()=>nextClaim(r,t.review,r.revision,true)).toThrow(/status|review/i)
})
it('retains known status observed before the first submission',async()=>{
 const t=await setup(),s=new AbortController().signal
 const empty=readSettlement({...nextClaim(undefined,t.review,undefined),attempts:[],lastStatus:{txid:t.review.txid,txStatus:'SEEN_ON_NETWORK',observedAt:new Date().toISOString()}})
 const cleared=await reconcileSettlement(empty,s,{status:async()=>undefined,save:async()=>{}})
 expect(cleared.attempts).toHaveLength(0)
 expect(()=>nextClaim(cleared,t.review,cleared.revision,true)).toThrow(/status|review/i)
})
