import {afterEach,expect,it,vi} from 'vitest'
import {Transaction,type WalletInterface} from '@bsv/sdk'
import {handoffFixture} from './helpers/handoff-fixture.ts'
import type {HeaderSnapshot} from '../src/headers/validate.ts'
import {newSettlement,readSettlement,checkHandoffStatus,checkHandoffMining,submitHandoff,reviewRecipientWallet,importReceivedTicket,type HandoffSettlement} from '../src/handoff/settlement.ts'
import type {RecordStore} from '../src/handoff/types.ts'
vi.mock('../src/verification/signing-spv.ts',async original=>({...await original<object>(),verifySigningEvidence:async(e:{atomicBeef:number[]},s?:HeaderSnapshot)=>{if(!s)throw Error('Verification incomplete — missing headers');return {subjectMined:!!Transaction.fromAtomicBEEF(e.atomicBeef).merklePath}}}))
const snapshot={id:'aa'.repeat(32)} as HeaderSnapshot
function memory(initial:HandoffSettlement){let r=structuredClone(initial);return {load:async()=>structuredClone(r),list:async()=>[r],save:async(n:HandoffSettlement,rev?:number)=>{if(rev!==r.revision)throw Error('Changed');r=readSettlement(n,r)},value:()=>r} satisfies RecordStore<HandoffSettlement>&{value:()=>HandoffSettlement}}
it('blocks a second publication after a lost response and keeps exact bytes',async()=>{
 const f=await handoffFixture(),r=newSettlement(f.ticket),store=memory(r);let posts=0
 const deps={status:async()=>undefined,policy:async()=>({feeBytes:1000,feeSatoshis:0,maxTxBytes:100000}),post:async(hex:string,id:string)=>{posts++;expect(id).toBe(f.ticket.pkg.current.txid);expect(hex).toBe(f.tx.toHexEF());throw Error('lost')}}
 const result=await submitHandoff(r,snapshot,new AbortController().signal,store,deps)
 expect(result.submit?.outcome).toBe('unknown');expect(posts).toBe(1)
 await expect(submitHandoff(result,snapshot,new AbortController().signal,store,deps)).rejects.toThrow(/already|attempt/i)
})
it('requires locally verified mining and matching recipient before importing',async()=>{
 const f=await handoffFixture(),r=newSettlement(f.ticket),store=memory(r),wallet={getNetwork:async()=>({network:'testnet'}),getPublicKey:f.recipient.getPublicKey.bind(f.recipient),listOutputs:async()=>({totalOutputs:0,outputs:[]}),internalizeAction:vi.fn()} as unknown as WalletInterface
 await expect(importReceivedTicket(r,wallet,snapshot,new AbortController().signal,store)).rejects.toThrow(/mining|mined/i)
 expect(wallet.internalizeAction).not.toHaveBeenCalled()
})
it('keeps accepted receipt separate from absent wallet observation and blocks duplicate import',async()=>{
 const f=await handoffFixture(true),r=newSettlement(f.ticket),store=memory(r);let count=0
 const wallet={getNetwork:async()=>({network:'testnet'}),getPublicKey:f.recipient.getPublicKey.bind(f.recipient),listOutputs:async()=>({totalOutputs:0,outputs:[]}),internalizeAction:async(args:Parameters<WalletInterface['internalizeAction']>[0])=>{count++;expect(args.outputs[0].outputIndex).toBe(0);return {accepted:true}}} as unknown as WalletInterface
 const result=await importReceivedTicket(r,wallet,snapshot,new AbortController().signal,store)
 expect(result.import?.outcome).toBe('complete');expect(result.wallet?.state).toBe('absent');expect(count).toBe(1)
 await expect(importReceivedTicket(result,wallet,snapshot,new AbortController().signal,store)).rejects.toThrow(/already|attempt/i)
})
it('malformed unrelated wallet output is inconclusive and cannot authorize import',async()=>{
 const f=await handoffFixture(true),wallet={getNetwork:async()=>({network:'testnet'}),getPublicKey:f.recipient.getPublicKey.bind(f.recipient),listOutputs:async()=>({totalOutputs:1,outputs:[{outpoint:'11'.repeat(32)+'.0'}]})} as unknown as WalletInterface
 expect((await reviewRecipientWallet(f.ticket,wallet,snapshot,new AbortController().signal)).state).toBe('inconclusive')
})
it('retains accepted import when the wallet disconnects during the following observation',async()=>{
 const f=await handoffFixture(true),r=newSettlement(f.ticket),store=memory(r);let accepted=false
 const wallet={getNetwork:async()=>{if(accepted)throw Error('wallet disconnected');return {network:'testnet'}},getPublicKey:f.recipient.getPublicKey.bind(f.recipient),listOutputs:async()=>({totalOutputs:0,outputs:[]}),internalizeAction:async()=>{accepted=true;return {accepted:true}}} as unknown as WalletInterface
 const result=await importReceivedTicket(r,wallet,snapshot,new AbortController().signal,store)
 expect(result.import?.outcome).toBe('complete');expect(store.value().import?.outcome).toBe('complete')
})

afterEach(()=>vi.unstubAllGlobals())
it('persists a not-found check across reload instead of leaving it unchecked',async()=>{
 const f=await handoffFixture(),r=newSettlement(f.ticket),store=memory(r)
 vi.stubGlobal('fetch',async()=>new Response('not found',{status:404}))
 const result=await checkHandoffStatus(r,new AbortController().signal,store)
 expect(result.notFoundAt).toEqual(expect.any(String))
 expect(readSettlement(await store.load()).notFoundAt).toBe(result.notFoundAt)
 expect(result.status).toBeUndefined()
})
it('retains an earlier received observation and blocks publication after a later 404',async()=>{
 const f=await handoffFixture(),r=readSettlement({...newSettlement(f.ticket),status:{txid:f.ticket.pkg.current.txid,txStatus:'RECEIVED',observedAt:new Date().toISOString()}}),store=memory(r)
 vi.stubGlobal('fetch',async()=>new Response('not found',{status:404}))
 const result=await checkHandoffStatus(r,new AbortController().signal,store)
 expect(result.notFoundAt).toEqual(expect.any(String));expect(result.status?.txStatus).toBe('RECEIVED')
 await expect(submitHandoff(result,snapshot,new AbortController().signal,store)).rejects.toThrow(/already|observed/i)
})
it('replaces the latest not-found display when the provider returns a transaction status',async()=>{
 const f=await handoffFixture(),r=newSettlement(f.ticket),store=memory(r)
 vi.stubGlobal('fetch',async()=>new Response('not found',{status:404}))
 const missing=await checkHandoffStatus(r,new AbortController().signal,store)
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({txid:f.ticket.pkg.current.txid,txStatus:'RECEIVED'})))
 const found=await checkHandoffStatus(missing,new AbortController().signal,store)
 expect(found.notFoundAt).toBeUndefined();expect(found.status?.txStatus).toBe('RECEIVED')
})

it('automatically prepares headers after saving MINED, retaining provider evidence on preparation failure',async()=>{
 const f=await handoffFixture(true),r=newSettlement(f.ticket),store=memory(r)
 const status={txid:r.ticket.pkg.current.txid,txStatus:'MINED',blockHeight:1762324,blockHash:'22'.repeat(32),merklePath:f.tx.merklePath!.toHex()}
 vi.stubGlobal('fetch',async()=>Response.json(status))
 let preparedHeight:number|undefined
 const result=await checkHandoffMining(r,new AbortController().signal,undefined,store,async(height)=>{
  preparedHeight=height
  expect(store.value().status?.txStatus).toBe('MINED')
  throw Error('temporary header interruption')
 })
 // The fixture also contains an offset-zero ancestor requiring 100 confirmations.
 expect(preparedHeight).toBe(1762424)
 expect(result.preparationError).toContain('temporary header interruption')
 expect(result.settlement.status?.txStatus).toBe('MINED')
 expect(store.value().ticket.pkg.atomicBeefBase64).toBe(r.ticket.pkg.atomicBeefBase64)
 expect(store.value().import).toBeUndefined();expect(store.value().submit).toBeUndefined()
})
it('does not promote mining when header preparation returns no evidence, or run it after a 404',async()=>{
 const f=await handoffFixture(true),r=newSettlement(f.ticket),store=memory(r)
 vi.stubGlobal('fetch',async()=>Response.json({txid:r.ticket.pkg.current.txid,txStatus:'MINED',blockHeight:1762324,blockHash:'22'.repeat(32),merklePath:f.tx.merklePath!.toHex()}))
 let preparations=0
 const result=await checkHandoffMining(r,new AbortController().signal,undefined,store,async()=>{preparations++;return undefined})
 expect(result.preparationError).toMatch(/header.*missing/i)
 expect(result.verification).toBeUndefined()
 vi.stubGlobal('fetch',async()=>new Response('',{status:404}))
 const missing=await checkHandoffMining(result.settlement,new AbortController().signal,undefined,store,async()=>{preparations++;return undefined})
 expect(missing.settlement.notFoundAt).toBeDefined();expect(preparations).toBe(1)
})
