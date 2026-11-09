import {it,expect,vi} from 'vitest'
import {syntheticSigningWallet} from './helpers/synthetic-signing-wallet.ts'
import {issueTicketExperiment,transferTicketExperiment} from '../src/wallet/ticket-experiment.ts'
import type {ExperimentRecord} from '../src/tickets/experiment-store.ts'
import {verifySavedTransfer,proveSavedKey,checkEvidenceKey} from '../src/offline/reopening.ts'
import {readReopeningEvidence,verifyReopeningEvidence} from '../src/offline/evidence.ts'
async function fixture(){
 const wallet=syntheticSigningWallet(),trusted=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,trusted,'event','ticket','reopening')
 const pkg=await transferTicketExperiment(wallet,prep)
 const record:ExperimentRecord={version:1,id:'reopening',revision:2,trusted,eventId:'event',ticketId:'ticket',attempt:{id:'transfer',phase:'transfer',status:'complete',at:new Date().toISOString()},references:[pkg.issuance.origin.txid,pkg.current.txid],pkg,buyer:prep.destination}
 return {wallet,record}
}
it('checks imported evidence against independently selected trust and buyer intent, without a journal',async()=>{
 const {record}=await fixture()
 const value={version:1,kind:'counterfoil-reopening-evidence',trusted:record.trusted,pkg:record.pkg,buyer:record.buyer}
 const evidence=readReopeningEvidence(value)
 const result=await verifyReopeningEvidence(evidence,undefined)
 expect(result.verdict).toBe('incomplete')
 expect(result.checks.filter(c=>c.status==='pass').map(c=>c.name)).toEqual(['issuer','continuity','recipient','transaction'])
 const wrongTrust=readReopeningEvidence({...value,trusted:record.buyer!.recipient.publicKey})
 expect((await verifyReopeningEvidence(wrongTrust,undefined)).checks.find(c=>c.name==='issuer')?.status).toBe('fail')
 const wrongBuyer=structuredClone(record.buyer!);wrongBuyer.recipient.publicKey=record.trusted
 expect((await verifyReopeningEvidence(readReopeningEvidence({...value,buyer:wrongBuyer}),undefined)).checks.find(c=>c.name==='recipient')?.status).toBe('fail')
 expect(()=>readReopeningEvidence({...value,buyer:undefined})).toThrow()
})
it('checks the receiving key from imported evidence without constructing a wallet journal or transaction',async()=>{
 const {record,wallet}=await fixture(),create=vi.spyOn(wallet,'createAction')
 const evidence={kind:'counterfoil-reopening-evidence',version:1,trusted:record.trusted,pkg:record.pkg,buyer:record.buyer}
 const result=await checkEvidenceKey(async()=>wallet,evidence,new AbortController().signal)
 expect(result.publicKey).toBe(record.buyer!.recipient.publicKey)
 expect(create).not.toHaveBeenCalled()
 const signature=vi.spyOn(wallet,'createSignature')
 await expect(checkEvidenceKey(async()=>wallet,{...evidence,trusted:record.buyer!.recipient.publicKey},new AbortController().signal)).rejects.toThrow()
 expect(signature).not.toHaveBeenCalled()
})
it('rechecks stored recipient and scripts offline, leaving missing headers incomplete',async()=>{
 const {record}=await fixture(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('No network'))
 try{const r=await verifySavedTransfer(record,undefined);expect(r.verdict).toBe('incomplete');expect(r.checks.filter(c=>c.status==='pass').map(c=>c.name)).toEqual(['issuer','continuity','recipient','transaction']);expect(fetch).not.toHaveBeenCalled()}finally{fetch.mockRestore()}
})
it('refuses uncertain journal outcomes and does not trust the package as its own buyer intent',async()=>{
 const {record}=await fixture()
 await expect(verifySavedTransfer({...record,attempt:{...record.attempt,status:'pending'}},undefined)).rejects.toThrow(/completed transfer/)
 const wrong=structuredClone(record);wrong.buyer!.requestId='different'
 // The codec or recipient check must reject altered independently stored intent.
 await expect(verifySavedTransfer(wrong,undefined)).rejects.toThrow()
})
it('proves fresh receiving-key access with real signatures, without creating a transaction',async()=>{
 const {wallet,record}=await fixture();const signature=vi.spyOn(wallet,'createSignature'),create=vi.spyOn(wallet,'createAction')
 const first=await proveSavedKey(wallet,record,new AbortController().signal)
 const second=await proveSavedKey(wallet,record,new AbortController().signal)
 expect(first.publicKey).toBe(record.buyer!.recipient.publicKey);expect(first.challenge).not.toEqual(second.challenge)
 expect(signature).toHaveBeenCalledTimes(2);expect(create).not.toHaveBeenCalled()
})
it('rejects wrong network, wrong key and invalid challenge signatures',async()=>{
 const {wallet,record}=await fixture()
 const signature=vi.spyOn(wallet,'createSignature')
 const network=vi.spyOn(wallet,'getNetwork').mockResolvedValue({network:'mainnet'})
 await expect(proveSavedKey(wallet,record,new AbortController().signal)).rejects.toThrow(/testnet/);expect(signature).not.toHaveBeenCalled();network.mockRestore()
 const get=wallet.getPublicKey.bind(wallet)
 vi.spyOn(wallet,'getPublicKey').mockImplementation(args=>get(args.identityKey?args:{identityKey:true}))
 await expect(proveSavedKey(wallet,record,new AbortController().signal)).rejects.toThrow(/receiving key/);expect(signature).not.toHaveBeenCalled();vi.mocked(wallet.getPublicKey).mockRestore()
 signature.mockResolvedValue({signature:[1,2,3]})
 await expect(proveSavedKey(wallet,record,new AbortController().signal)).rejects.toThrow(/signature/)
})
it('cancels a stalled wallet read before signing and ignores its late return',async()=>{
 const {wallet,record}=await fixture(),c=new AbortController(),signature=vi.spyOn(wallet,'createSignature')
 let resolve!:(v:{network:'testnet'})=>void
 vi.spyOn(wallet,'getNetwork').mockReturnValue(new Promise(r=>{resolve=r}))
 const pending=proveSavedKey(wallet,record,c.signal);await vi.waitFor(()=>expect(wallet.getNetwork).toHaveBeenCalled());c.abort(new Error('cancelled'))
 await expect(pending).rejects.toThrow('cancelled');resolve({network:'testnet'});await Promise.resolve();expect(signature).not.toHaveBeenCalled()
})

it('settles cancellation during wallet client loading and suppresses late wallet calls',async()=>{
 const {wallet,record}=await fixture(),controller=new AbortController(),network=vi.spyOn(wallet,'getNetwork'),signature=vi.spyOn(wallet,'createSignature')
 let release!:(client:typeof wallet)=>void
 const loaded=new Promise<typeof wallet>(resolve=>{release=resolve})
 const {checkSavedKey}=await import('../src/offline/reopening.ts')
 const load=vi.fn(()=>loaded)
 const pending=checkSavedKey(load,record,controller.signal)
 await vi.waitFor(()=>expect(load).toHaveBeenCalled())
 controller.abort(new Error('loading cancelled'))
 await expect(pending).rejects.toThrow('loading cancelled')
 release(wallet);await new Promise(resolve=>setTimeout(resolve,0))
 expect(network).not.toHaveBeenCalled();expect(signature).not.toHaveBeenCalled()
})
