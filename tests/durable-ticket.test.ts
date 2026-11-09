import {it,expect,vi,afterEach} from 'vitest'
import {Beef,MerklePath,Transaction,Utils} from '@bsv/sdk'
import {syntheticSigningWallet} from './helpers/synthetic-signing-wallet.ts'
import {issueTicketExperiment} from '../src/wallet/ticket-experiment.ts'
import {refreshIssuanceEvidence,prepareMinedTransfer} from '../src/wallet/durable-ticket.ts'
import * as spv from '../src/verification/signing-spv.ts'
afterEach(()=>vi.restoreAllMocks())
async function fixture(){
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','run')
 const tx=Transaction.fromHex(prep.pkg.lineageRawTxs[0])
 tx.merklePath=new MerklePath(1,[[{offset:1,hash:tx.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
 wallet.listOutputs=vi.fn(async()=>({totalOutputs:1,outputs:[{outpoint:`${tx.id('hex')}.0`,satoshis:1,spendable:true}],BEEF:tx.toBEEF()}))
 return {wallet,identity,prep,tx}
}
it('explicit durable issuance asks the wallet to broadcast immediately and does not return staged change',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey,create=vi.spyOn(wallet,'createAction')
 const result=await issueTicketExperiment(wallet,identity,'event','ticket','durable',()=>{},'broadcast')
 expect(create.mock.calls[0][0].options).toMatchObject({noSend:false,acceptDelayedBroadcast:false,returnTXIDOnly:false})
 expect(create.mock.calls[0][0].labels).toContain('counterfoil-issuance-durable')
 expect(result.noSendChange).toEqual([])
})
it('refreshes exact issuance evidence through reads while preserving attestation and raw lineage',async()=>{
 const {wallet,identity,prep,tx}=await fixture(),create=vi.spyOn(wallet,'createAction')
 const result=await refreshIssuanceEvidence(wallet,prep.pkg,identity)
 expect(result.issuance).toEqual(prep.pkg.issuance);expect(result.lineageRawTxs).toEqual(prep.pkg.lineageRawTxs)
 expect(Transaction.fromAtomicBEEF(Utils.toArray(result.atomicBeefBase64,'base64')).merklePath?.blockHeight).toBe(1)
 expect(result.current.txid).toBe(tx.id('hex'));expect(create).not.toHaveBeenCalled()
})
it.each(['missing','partial','wrong value','no proof'])('refuses unusable source evidence: %s',async mode=>{
 const {wallet,identity,prep,tx}=await fixture()
 wallet.listOutputs=async()=>({totalOutputs:mode==='partial'?1001:1,outputs:mode==='missing'?[]:[{outpoint:`${tx.id('hex')}.0`,satoshis:mode==='wrong value'?2:1,spendable:true}],BEEF:mode==='no proof'?Beef.fromBinary(Utils.toArray(prep.pkg.atomicBeefBase64,'base64')).toBinary():tx.toBEEF()})
 await expect(refreshIssuanceEvidence(wallet,prep.pkg,identity)).rejects.toThrow()
})
it('prepares a mined source without old noSendChange and requires the local verifier to confirm the subject',async()=>{
 const {wallet,identity,prep}=await fixture(),pkg=await refreshIssuanceEvidence(wallet,prep.pkg,identity)
 const verify=vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:pkg.current.txid,subjectMined:true,anchors:[1],proofBytes:100,snapshotId:'synthetic-test'})
 const result=await prepareMinedTransfer(wallet,pkg,prep.destination,identity,undefined)
 expect(result.source).toEqual(prep.source);expect(result.noSendChange).toEqual([])
 verify.mockResolvedValue({txid:pkg.current.txid,subjectMined:false,anchors:[1],proofBytes:100,snapshotId:'synthetic-test'})
 await expect(prepareMinedTransfer(wallet,pkg,prep.destination,identity,undefined)).rejects.toThrow(/mined/i)
 verify.mockRejectedValue(Error('missing header'))
 await expect(prepareMinedTransfer(wallet,pkg,prep.destination,identity,undefined)).rejects.toThrow('missing header')
})
it('rejects another wallet and substituted buyer before preparing a transfer',async()=>{
 const {wallet,identity,prep}=await fixture(),pkg=await refreshIssuanceEvidence(wallet,prep.pkg,identity)
 vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:pkg.current.txid,subjectMined:true,anchors:[1],proofBytes:100,snapshotId:'test'})
 await expect(prepareMinedTransfer(wallet,pkg,prep.source,identity,undefined)).rejects.toThrow()
 wallet.getNetwork=async()=>({network:'mainnet'})
 await expect(refreshIssuanceEvidence(wallet,pkg,identity)).rejects.toThrow(/testnet/)
})
it('refuses empty BEEF and an output claiming the ticket while supplying different transaction bytes',async()=>{
 const {wallet,identity,prep,tx}=await fixture()
 wallet.listOutputs=async()=>({totalOutputs:1,outputs:[{outpoint:`${tx.id('hex')}.0`,satoshis:1,spendable:true}],BEEF:[]})
 await expect(refreshIssuanceEvidence(wallet,prep.pkg,identity)).rejects.toThrow()
 tx.outputs[0].satoshis=2
 wallet.listOutputs=async()=>({totalOutputs:1,outputs:[{outpoint:`${prep.pkg.current.txid}.0`,satoshis:1,spendable:true}],BEEF:tx.toBEEF()})
 await expect(refreshIssuanceEvidence(wallet,prep.pkg,identity)).rejects.toThrow()
})
it('a mining claim without local headers cannot prepare resale',async()=>{
 const {wallet,identity,prep}=await fixture()
 await expect(prepareMinedTransfer(wallet,prep.pkg,prep.destination,identity,undefined)).rejects.toThrow(/header/i)
})
it('transfers a mined issuance into a newly signed unmined successor without obsolete change',async()=>{
 const {wallet,identity,prep}=await fixture()
 const pkg=await refreshIssuanceEvidence(wallet,prep.pkg,identity)
 const {transferTicketExperiment}=await import('../src/wallet/ticket-experiment.ts')
 const create=vi.spyOn(wallet,'createAction'),sign=vi.spyOn(wallet,'signAction')
 const successor=await transferTicketExperiment(wallet,{...prep,pkg,noSendChange:[]})
 expect(successor.lineageRawTxs).toHaveLength(2)
 expect(successor.lineageRawTxs[0]).toBe(pkg.lineageRawTxs[0])
 const tx=Transaction.fromAtomicBEEF(Utils.toArray(successor.atomicBeefBase64,'base64'))
 expect(tx.merklePath).toBeUndefined();expect(tx.inputs[0].sourceTransaction?.merklePath).toBeDefined()
 expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0][0].options?.noSendChange).toEqual([])
 expect(sign).toHaveBeenCalledTimes(1);expect(sign.mock.calls[0][0].options?.noSend).toBe(true)
})
it('still rejects a newly returned final transaction that claims it is already mined',async()=>{
 const {prep,tx}=await fixture()
 const {inspectFinal}=await import('../src/wallet/signing-experiment.ts')
 await expect(inspectFinal({tx:tx.toAtomicBEEF(),txid:prep.pkg.current.txid},tx.outputs[0].lockingScript.toHex())).rejects.toThrow('Expected a newly created, unmined transaction.')
})
async function failedPreflight(){
 const f=await fixture(),pkg=await refreshIssuanceEvidence(f.wallet,f.prep.pkg,f.identity)
 const record={version:1 as const,id:'run',revision:4,trusted:f.identity,eventId:'event',ticketId:'ticket',pkg,buyer:f.prep.destination,references:[pkg.current.txid],attempt:{id:'failed-transfer',phase:'transfer' as const,status:'failed' as const,at:'2026-10-24T16:00:00.000Z'},failure:{name:'Error',message:'Expected a newly created, unmined transaction.',method:'getPublicKey'}}
 return {...f,record}
}
it('reviews only the known pre-mutation mined-source failure and preserves it in the recovered diagnostic',async()=>{
 const {wallet,record}=await failedPreflight()
 const {recoverMinedSourcePreflight}=await import('../src/wallet/durable-ticket.ts')
 vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:record.pkg.current.txid,subjectMined:true,anchors:[1],proofBytes:100,snapshotId:'test'})
 const create=vi.spyOn(wallet,'createAction'),sign=vi.spyOn(wallet,'createSignature'),finalize=vi.spyOn(wallet,'signAction')
 const recovered=await recoverMinedSourcePreflight(wallet,record,undefined)
 expect(recovered.record.attempt).toMatchObject({phase:'issue',status:'complete'})
 expect(recovered.record.recoveredPreflight?.attempt).toEqual(record.attempt)
 expect(recovered.record.recoveredPreflight?.failure).toEqual(record.failure)
 expect(recovered.record.pkg?.current).toEqual(record.pkg.current)
 expect(recovered.preparation.noSendChange).toEqual([])
 expect(create).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();expect(finalize).not.toHaveBeenCalled()
})
it.each(['pending','different error','wallet error','mutation method','extra reference','already recovered'])('never reopens an uncertain mutation: %s',async mode=>{
 const {wallet,record}=await failedPreflight()
 const {recoverMinedSourcePreflight}=await import('../src/wallet/durable-ticket.ts')
 const changed=structuredClone(record) as import('../src/tickets/experiment-store.ts').ExperimentRecord
 if(mode==='pending')changed.attempt.status='pending'
 if(mode==='different error')changed.failure!.message='HTTP status 400'
 if(mode==='wallet error')changed.failure!.walletResponse={method:'getPublicKey',status:400}
 if(mode==='mutation method')changed.failure!.method='signAction'
 if(mode==='extra reference')changed.references.push('dGVzdA==')
 if(mode==='already recovered')changed.recoveredPreflight={attempt:record.attempt,failure:record.failure,at:'2026-10-24T16:10:00.000Z'}
 const read=vi.spyOn(wallet,'getNetwork')
 await expect(recoverMinedSourcePreflight(wallet,changed,undefined)).rejects.toThrow(/review/i)
 expect(read).not.toHaveBeenCalled()
})
it('keeps recovery blocked when the source or local headers cannot be revalidated',async()=>{
 const {wallet,record}=await failedPreflight()
 const {recoverMinedSourcePreflight}=await import('../src/wallet/durable-ticket.ts')
 await expect(recoverMinedSourcePreflight(wallet,record,undefined)).rejects.toThrow(/header/i)
 expect(record.attempt.status).toBe('failed')
})
it('retains the reviewed failure when saving and reloading a subsequent signed transfer',async()=>{
 const {wallet,record}=await failedPreflight()
 const {recoverMinedSourcePreflight}=await import('../src/wallet/durable-ticket.ts')
 const {transferTicketExperiment}=await import('../src/wallet/ticket-experiment.ts')
 const {readExperiment}=await import('../src/tickets/experiment-store.ts')
 vi.spyOn(spv,'verifySigningEvidence').mockResolvedValue({txid:record.pkg.current.txid,subjectMined:true,anchors:[1],proofBytes:100,snapshotId:'test'})
 const recovered=await recoverMinedSourcePreflight(wallet,record,undefined)
 const pkg=await transferTicketExperiment(wallet,recovered.preparation)
 const saved=readExperiment(JSON.parse(JSON.stringify({...recovered.record,pkg,references:[...recovered.record.references,'draft-ref',pkg.current.txid],attempt:{id:'next-transfer',phase:'transfer',status:'complete',at:'2026-10-24T17:00:00.000Z'}})))
 expect(saved.pkg?.lineageRawTxs).toHaveLength(2)
 expect(saved.recoveredPreflight?.attempt).toEqual(record.attempt)
 expect(saved.recoveredPreflight?.failure).toEqual(record.failure)
})
