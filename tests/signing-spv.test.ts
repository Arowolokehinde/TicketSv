import { it,expect,vi } from 'vitest'
import { Transaction, UnlockingScript, MerklePath } from '@bsv/sdk'
import fixture from './fixtures/headers/mined-ancestor.json' with { type:'json' }
import a from './fixtures/headers/woc-1762324.json' with { type:'json' }
import b from './fixtures/headers/woc-1762325.json' with { type:'json' }
import {makeSnapshot,parseProviderHeader} from '../src/headers/validate.ts'
import {readSigningEvidence,verifySigningEvidence} from '../src/verification/signing-spv.ts'
const headers=[parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)]
it('verifies a real public mined ancestor against cross-checked headers without fetch',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('forbidden'))
 try {
  const evidence=readSigningEvidence(JSON.stringify(fixture))
  const result=await verifySigningEvidence(evidence,makeSnapshot(headers))
  expect(result.txid).toBe(fixture.final.txid);expect(result.anchors).toEqual([b.height]);expect(result.subjectMined).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
 }finally{fetch.mockRestore()}
})
it('fails closed with the actionable missing-header reason',async()=>{
 const evidence=readSigningEvidence(JSON.stringify(fixture))
 await expect(verifySigningEvidence(evidence,undefined)).rejects.toThrow('required block header missing')
 await expect(verifySigningEvidence(evidence,makeSnapshot(headers.slice(0,1)))).rejects.toThrow('required block header missing')
})
it('rejects a proof moved to another locally known height',async()=>{
 const tx=Transaction.fromAtomicBEEF(fixture.final.atomicBeef);tx.merklePath!.blockHeight=a.height
 const altered={...fixture,final:{...fixture.final,atomicBeef:tx.toAtomicBEEF()}}
 await expect(verifySigningEvidence(readSigningEvidence(JSON.stringify(altered)),makeSnapshot(headers))).rejects.toThrow(/Merkle/i)
})
it('rejects invalid envelopes, byte arrays and mismatched txids',()=>{
 for(const obj of [{}, {...fixture,network:'mainnet'}, {...fixture,final:{...fixture.final,txid:'00'.repeat(32)}}, {...fixture,final:{...fixture.final,atomicBeef:[256]}}])expect(()=>readSigningEvidence(JSON.stringify(obj))).toThrow()
})
it('rejects an unsigned spend even when its ancestor has a valid Merkle anchor',async()=>{
 const parent=Transaction.fromAtomicBEEF(fixture.final.atomicBeef)
 const tx=new Transaction(1,[{sourceTransaction:parent,sourceOutputIndex:0,unlockingScript:new UnlockingScript()}],parent.outputs)
 const bad={...fixture,final:{txid:tx.id('hex'),atomicBeef:tx.toAtomicBEEF(),outputIndex:0}}
 await expect(verifySigningEvidence(readSigningEvidence(JSON.stringify(bad)),makeSnapshot(headers))).rejects.toThrow()
})

it('derives the additional local depth needed by a coinbase anchor',()=>{
 const tx=Transaction.fromAtomicBEEF(fixture.final.atomicBeef)
 tx.merklePath=new MerklePath(b.height,[[{offset:0,hash:tx.id('hex'),txid:true}]])
 const evidence=readSigningEvidence(JSON.stringify({...fixture,final:{...fixture.final,atomicBeef:tx.toAtomicBEEF()}}))
 expect(evidence.requiredHeight).toBe(1762425)
})
