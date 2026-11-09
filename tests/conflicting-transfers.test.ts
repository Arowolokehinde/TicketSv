import {afterEach,expect,it,vi} from 'vitest'
import {reviewConflictPair,doorVerdict,verifyCompetingSpend} from '../src/conflicts/verify.ts'
import {conflictFixture} from './helpers/conflict-fixture.ts'
import * as spv from '../src/verification/signing-spv.ts'
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import h from './fixtures/headers/woc-1762324.json' with {type:'json'}
import type {Verification} from '../src/tickets/types.ts'
const snapshot=makeSnapshot([parseProviderHeader(h,'whatsonchain',h.height)])
afterEach(()=>vi.restoreAllMocks())
function anchors(){vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:'',anchors:[1],subjectMined:false,proofBytes:1,snapshotId:snapshot.id})}
it('both signed branches verify offline but door policy requires online checking',async()=>{
 anchors();const {pair,base}=await conflictFixture();const result=await reviewConflictPair(pair,snapshot)
 expect(result.verdict).toBe('verified');expect(result.sharedTicket).toBe(`${base.current.txid}.0`)
 expect(result.reviews.a?.fee).toBe(1000);expect(result.reviews.b?.fee).toBe(1000)
 expect(doorVerdict(result.checks.a)).toBe('online-check-required');expect(doorVerdict(result.checks.b)).toBe('online-check-required')
})
it('rejects identical, same-buyer, reused fee and unrelated issuance pairs',async()=>{
 anchors();const f=await conflictFixture()
 for(const b of [f.pair.a,await f.branch(f.a,2),await f.branch(f.b,1)])expect((await reviewConflictPair({a:f.pair.a,b},snapshot)).verdict).toBe('rejected')
 const bad=structuredClone(f.pair);bad.b.pkg.issuance.ticketId+='wrong';expect((await reviewConflictPair(bad,snapshot)).verdict).toBe('rejected')
})
it('missing anchors stay incomplete and wrong receiving request rejects',async()=>{
 const {pair}=await conflictFixture();expect((await reviewConflictPair(pair,undefined)).verdict).toBe('incomplete')
 const bad=structuredClone(pair);bad.b.buyer=pair.a.buyer;expect((await reviewConflictPair(bad,undefined)).verdict).toBe('rejected')
})
it('door rejects invalid evidence and never treats incomplete or unmined as mined',()=>{
 const v:Verification={verdict:'verified',checks:[],presentedTransferMined:true,anchorHeights:[1]}
 expect(doorVerdict(v)).toBe('passes-poc-policy');expect(doorVerdict({...v,verdict:'rejected'})).toBe('rejected');expect(doorVerdict({...v,verdict:'incomplete'})).toBe('incomplete')
})
it('generic network labels or missing proof cannot confirm a conflicting mined spend',async()=>{
 anchors();const {pair}=await conflictFixture()
 for(const txStatus of ['REJECTED','DOUBLE_SPEND_ATTEMPTED','MINED_IN_STALE_BLOCK','UNKNOWN','MINED']){
  const result=await verifyCompetingSpend(pair,'a',{txid:pair.a.pkg.current.txid,txStatus,observedAt:new Date().toISOString()},snapshot)
  expect(result.verdict).not.toBe('conflicting-spend-mined-in-local-snapshot')
 }
})

import {MerklePath} from '@bsv/sdk'
import * as mining from '../src/settlement/evidence.ts'
import {verifyConflictSettlement} from '../src/conflicts/settlement.ts'
import type {ConflictRecord} from '../src/conflicts/store.ts'
function minedObservation(txid:string){return {txid,txStatus:'MINED',observedAt:new Date().toISOString(),blockHeight:h.height,blockHash:h.hash,merklePath:new MerklePath(h.height,[[{offset:1,hash:txid,txid:true},{offset:0,hash:'22'.repeat(32)}]]).toHex()}}
// A new synthetic ticket cannot have a real public-chain mining proof. The
// positive policy tests substitute only the existing mined-proof verifier;
// real subject/block/root rejection is exercised separately below and by ARC tests.
it('only a locally verified winner binds the opposite exact ticket spend to its snapshot',async()=>{
 anchors();const {pair}=await conflictFixture(),o=minedObservation(pair.a.pkg.current.txid)
 const check=vi.spyOn(mining,'verifyMinedCandidate').mockResolvedValue({verdict:'verified',checks:[],presentedTransferMined:true,anchorHeights:[h.height],snapshotId:snapshot.id})
 const result=await verifyCompetingSpend(pair,'a',o,snapshot)
 expect(result).toMatchObject({verdict:'conflicting-spend-mined-in-local-snapshot',winner:pair.a.pkg.current.txid,loser:pair.b.pkg.current.txid,snapshotId:snapshot.id})
 expect(check).toHaveBeenCalledWith(pair.a,o,snapshot)
 check.mockResolvedValue({verdict:'incomplete',checks:[],presentedTransferMined:false,anchorHeights:[]});expect((await verifyCompetingSpend(pair,'a',o,snapshot)).verdict).toBe('incomplete')
})
it('actual proof parser rejects wrong subject, block hash and mismatched root',async()=>{
 anchors();const {pair}=await conflictFixture(),o=minedObservation(pair.a.pkg.current.txid)
 for(const observation of [{...o,txid:pair.b.pkg.current.txid},{...o,blockHash:'00'.repeat(32)},o])expect((await verifyCompetingSpend(pair,'a',observation,snapshot)).verdict).toBe('rejected')
})
it('settlement uses the latest stale/not-found result instead of an earlier mined observation',async()=>{
 anchors();const {pair}=await conflictFixture(),o=minedObservation(pair.a.pkg.current.txid)
 const verify=vi.spyOn(mining,'verifyMinedCandidate').mockResolvedValue({verdict:'verified',checks:[],presentedTransferMined:true,anchorHeights:[h.height],snapshotId:snapshot.id})
 const base={branches:pair,observations:{a:[{checkedAt:o.observedAt,value:o}]}} as unknown as ConflictRecord
 expect((await verifyConflictSettlement(base,snapshot)).a.verdict).toBe('conflicting-spend-mined-in-local-snapshot')
 verify.mockClear()
 for(const value of [{...o,txStatus:'MINED_IN_STALE_BLOCK'},undefined]){
  const r={...base,observations:{a:[...base.observations.a!,{checkedAt:o.observedAt,value}]}}
  expect((await verifyConflictSettlement(r,snapshot)).a.verdict).toBe('incomplete')
 }
 expect(verify).not.toHaveBeenCalled()
})
it('two purported mined competing branches are inconsistent evidence, never two winners',async()=>{
 anchors();const {pair}=await conflictFixture()
 vi.spyOn(mining,'verifyMinedCandidate').mockResolvedValue({verdict:'verified',checks:[],presentedTransferMined:true,anchorHeights:[h.height],snapshotId:snapshot.id})
 const result=await verifyConflictSettlement({branches:pair,observations:{a:[{checkedAt:new Date().toISOString(),value:minedObservation(pair.a.pkg.current.txid)}],b:[{checkedAt:new Date().toISOString(),value:minedObservation(pair.b.pkg.current.txid)}]}} as unknown as ConflictRecord,snapshot)
 expect(result.a.verdict).toBe('rejected');expect(result.b.verdict).toBe('rejected')
})
