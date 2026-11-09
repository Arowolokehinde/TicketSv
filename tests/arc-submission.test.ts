import {afterEach,expect,it,vi} from 'vitest'
import {Transaction,MerklePath,Utils} from '@bsv/sdk'
import {fetchPolicy,fetchStatus,postTransfer,parseObservation,checkPolicy} from '../src/settlement/arc.ts'
import {reviewTransfer,minedCandidate,verifyMiningAnchor} from '../src/settlement/evidence.ts'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import * as spv from '../src/verification/signing-spv.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1762324.json' with {type:'json'}
import b from './fixtures/headers/woc-1762325.json' with {type:'json'}
import mined from './fixtures/headers/mined-ancestor.json' with {type:'json'}
const snapshot=makeSnapshot([parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)])
const id='ab'.repeat(32),signal=()=>new AbortController().signal
const observation={txid:id,txStatus:'SEEN_ON_NETWORK',timestamp:'2026-10-25T00:00:00Z'}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()})
it('recognizes multiple-node propagation without treating it as mined evidence',()=>{
 const seen=parseObservation({...observation,txStatus:'SEEN_MULTIPLE_NODES'},id)
 expect(seen.txStatus).toBe('SEEN_MULTIPLE_NODES')
 expect(()=>verifyMiningAnchor(seen,snapshot)).toThrow()
})
it('reports an unsupported pending provider status without accepting it as mining',()=>{
 expect(()=>parseObservation({...observation,txStatus:'NEW_PENDING_STATUS'},id)).toThrow('Unrecognized ARC transaction status (NEW_PENDING_STATUS). Mining is not confirmed; check again later.')
})
it('uses a fixed provider and preserves status without accepting the wrong transaction',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(observation)))
 expect((await fetchStatus(id,signal()))?.txStatus).toBe('SEEN_ON_NETWORK')
 expect(fetch.mock.calls[0][0]).toBe(`https://arcade-v2-testnet-us-1.bsvblockchain.tech/tx/${id}`)
 expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error',cache:'no-store'})
 fetch.mockResolvedValue(new Response(JSON.stringify({...observation,txid:'cd'.repeat(32)})))
 await expect(fetchStatus(id,signal())).rejects.toThrow(/transaction/i)
 for(const txStatus of ['made-up','', 'MINED']) {
  if(txStatus==='MINED')expect(parseObservation({...observation,txStatus},id).txStatus).toBe('MINED')
  else expect(()=>parseObservation({...observation,txStatus},id)).toThrow()
 }
})
it('404 is unknown only for GET; POST sends the exact reviewed EF once',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('{}',{status:404}))
 expect(await fetchStatus(id,signal())).toBeUndefined()
 await expect(postTransfer('abcd',id,signal())).rejects.toThrow(/404/)
 expect(fetch.mock.calls[1][1]).toMatchObject({method:'POST',body:'abcd',headers:{'Content-Type':'text/plain'}})
 expect(fetch).toHaveBeenCalledTimes(2)
 fetch.mockResolvedValue(new Response('{}',{status:403}));await expect(fetchStatus(id,signal())).rejects.toThrow(/403/)
})
it('validates policy and calculates the minimum with exact integer rounding',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({policy:{maxtxsizepolicy:100000000,miningFee:{satoshis:1,bytes:1000}}})))
 const p=await fetchPolicy(signal());expect(checkPolicy({rawBytes:553,fee:139},p)).toBe(1)
 expect(()=>checkPolicy({rawBytes:1001,fee:1},p)).toThrow(/fee/i)
 expect(()=>checkPolicy({rawBytes:100000001,fee:1000000},p)).toThrow(/size/i)
 expect(()=>checkPolicy({rawBytes:1,fee:1},{...p,feeBytes:0})).toThrow()
})
it('bounds responses, honors cancellation and never retries a failed POST',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('x'.repeat(4*1024*1024+1)))
 await expect(fetchStatus(id,signal())).rejects.toThrow(/limit/i)
 fetch.mockRejectedValue(new TypeError('Failed to fetch'))
 await expect(postTransfer('abcd',id,signal())).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(2)
 const c=new AbortController();c.abort();await expect(fetchStatus(id,c.signal)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(2)
})
it('times out a stalled response body as well as a stalled connection',async()=>{
 vi.useFakeTimers()
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({start(){}})))
 const result=expect(fetchStatus(id,signal())).rejects.toThrow(/timeout/i)
 await vi.advanceTimersByTimeAsync(30001);await result
})
it('requires local anchors and rejects tampering before reviewing a transfer',async()=>{
 const f=await ticketFixture(),e={kind:'counterfoil-reopening-evidence' as const,version:1 as const,trusted:f.identity,pkg:f.pkg,buyer:f.destination}
 await expect(reviewTransfer(e,undefined)).rejects.toThrow(/incomplete/i)
 const bad=structuredClone(e);bad.pkg.issuance.ticketId+='changed';await expect(reviewTransfer(bad,snapshot)).rejects.toThrow(/reject/i)
})
it('reviews exact signed bytes and mined parents without changing the transaction',async()=>{
 const f=await ticketFixture(),e={kind:'counterfoil-reopening-evidence' as const,version:1 as const,trusted:f.identity,pkg:f.pkg,buyer:f.destination}
 // Synthetic ticket anchors have no real PoW. Stub only SPV for amount/EF tests;
 // real header/proof agreement is tested below with public mined evidence.
 vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:f.pkg.current.txid,anchors:[1],subjectMined:false,proofBytes:100,snapshotId:snapshot.id})
 await expect(reviewTransfer(e,snapshot)).rejects.toThrow(/unmined ancestor/i)
 f.issue.merklePath=new MerklePath(1,[[{offset:1,hash:f.issue.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
 e.pkg.atomicBeefBase64=Utils.toBase64(f.transfer.toAtomicBEEF())
 const r=await reviewTransfer(e,snapshot)
 expect(r.inputs[0].satoshis).toBe(1);expect(r.outputs).toEqual([{index:0,satoshis:1}]);expect(r.fee).toBe(0)
 expect(r.rawHex).toBe(f.transfer.toHex());expect(Transaction.fromHexEF(r.efHex).toHex()).toBe(f.transfer.toHex())
 const wrong=structuredClone(e);wrong.buyer=f.source;await expect(reviewTransfer(wrong,snapshot)).rejects.toThrow(/reject/i)
})
it('attaches only a matching subject proof and preserves signed lineage',async()=>{
 const f=await ticketFixture(),e={kind:'counterfoil-reopening-evidence' as const,version:1 as const,trusted:f.identity,pkg:f.pkg,buyer:f.destination}
 const proof=new MerklePath(b.height,[[{offset:1,hash:f.pkg.current.txid,txid:true},{offset:0,hash:'11'.repeat(32)}]])
 const o=parseObservation({txid:f.pkg.current.txid,txStatus:'MINED',blockHeight:b.height,blockHash:b.hash,merklePath:proof.toHex()},f.pkg.current.txid)
 const candidate=minedCandidate(e,o)
 expect(candidate.pkg.lineageRawTxs).toEqual(e.pkg.lineageRawTxs)
 expect(Transaction.fromAtomicBEEF(Utils.toArray(candidate.pkg.atomicBeefBase64,'base64')).toHex()).toBe(f.transfer.toHex())
 expect(e.pkg.atomicBeefBase64).not.toBe(candidate.pkg.atomicBeefBase64)
 expect(()=>minedCandidate(e,{...o,blockHeight:b.height+1})).toThrow()
 expect(()=>minedCandidate(e,{...o,txid:id})).toThrow()
 expect(()=>minedCandidate(e,{...o,merklePath:undefined})).toThrow()
 expect(()=>verifyMiningAnchor(o,snapshot)).toThrow(/root/i)
})
it('checks a genuine public subject proof against local block hash and root without fetch',()=>{
 const tx=Transaction.fromAtomicBEEF(mined.final.atomicBeef)
 const o=parseObservation({txid:tx.id('hex'),txStatus:'MINED',blockHeight:b.height,blockHash:b.hash,merklePath:tx.merklePath!.toHex()},tx.id('hex'))
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('forbidden'))
 expect(verifyMiningAnchor(o,snapshot)).toBe(true)
 expect(verifyMiningAnchor(o,undefined)).toBe(false)
 expect(()=>verifyMiningAnchor({...o,blockHash:'00'.repeat(32)},snapshot)).toThrow(/block/i)
 expect(()=>verifyMiningAnchor({...o,txid:id},snapshot)).toThrow(/subject/i)
 expect(()=>verifyMiningAnchor({...o,txStatus:'MINED_IN_STALE_BLOCK'},snapshot)).toThrow()
 expect(fetch).not.toHaveBeenCalled()
})
