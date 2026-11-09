import {it,expect,vi} from 'vitest'
import {syntheticSigningWallet} from './helpers/synthetic-signing-wallet.ts'
import {issueTicketExperiment,transferTicketExperiment,confirmIssuanceRequest,restoreTicketPreparation} from '../src/wallet/ticket-experiment.ts'
import {verifyIssuer,verifyContinuity,verifyRecipient} from '../src/verification/authenticity.ts'
import {ticketScript} from '../src/tickets/script.ts'
import {PushDrop,Transaction} from '@bsv/sdk'
import {RECEIVE_PROTOCOL} from '../src/tickets/types.ts'
it('recovers the issuance holder request through public wallet reads without another action or signature',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','run')
 const create=vi.spyOn(wallet,'createAction'),sign=vi.spyOn(wallet,'createSignature'),finalize=vi.spyOn(wallet,'signAction')
 expect(await confirmIssuanceRequest(wallet,prep.pkg,identity)).toEqual(prep.source)
 expect(create).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();expect(finalize).not.toHaveBeenCalled()
})
it('does not accept package-supplied recipient keys without a matching wallet derivation',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','run'),get=wallet.getPublicKey.bind(wallet)
 vi.spyOn(wallet,'getPublicKey').mockImplementation(args=>args.identityKey?get(args):Promise.resolve({publicKey:prep.destination.recipient.publicKey}))
 await expect(confirmIssuanceRequest(wallet,prep.pkg,identity)).rejects.toThrow(/request|recipient/i)
})
it('rejects a different wallet identity and rejects successor recovery in the issuance-only helper',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','run'),successor=await transferTicketExperiment(wallet,prep)
 await expect(confirmIssuanceRequest(wallet,successor,identity)).rejects.toThrow(/issuance/i)
 const get=wallet.getPublicKey.bind(wallet)
 vi.spyOn(wallet,'getPublicKey').mockImplementation(args=>args.identityKey?Promise.resolve({publicKey:prep.destination.recipient.publicKey}):get(args))
 await expect(confirmIssuanceRequest(wallet,prep.pkg,identity)).rejects.toThrow(/identity/i)
})
it('rejects a wallet profile change during read-only request recovery',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','run'),get=wallet.getPublicKey.bind(wallet);let identityReads=0
 vi.spyOn(wallet,'getPublicKey').mockImplementation(args=>args.identityKey&&++identityReads===2?Promise.resolve({publicKey:prep.destination.recipient.publicKey}):get(args))
 await expect(confirmIssuanceRequest(wallet,prep.pkg,identity)).rejects.toThrow(/identity/i)
})
it('uses noSend for issuance and transfer and signs the finalized origin for public verification',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const create=vi.spyOn(wallet,'createAction'),sign=vi.spyOn(wallet,'signAction'),attest=vi.spyOn(wallet,'createSignature')
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','test-run')
 expect(()=>verifyIssuer(prep.pkg,identity)).not.toThrow();expect(prep.pkg.current).toEqual(prep.pkg.issuance.origin)
 expect(attest.mock.calls.some(([a])=>a.counterparty==='anyone'&&a.keyID===`${prep.pkg.current.txid}.0`)).toBe(true)
 const result=await transferTicketExperiment(wallet,prep)
 expect(create.mock.calls.every(([a])=>a.options?.noSend===true)).toBe(true)
 expect(sign.mock.calls[0][0].options?.noSend).toBe(true)
 expect(result.lineageRawTxs).toHaveLength(2);expect(()=>verifyContinuity(result)).not.toThrow();expect(()=>verifyRecipient(result,prep.destination)).not.toThrow()
})
it('rejects a changed wallet identity before any createAction',async()=>{
 const wallet=syntheticSigningWallet(),create=vi.spyOn(wallet,'createAction')
 await expect(issueTicketExperiment(wallet,'02'+'11'.repeat(32),'event','ticket','run')).rejects.toThrow()
 expect(create).not.toHaveBeenCalled()
})
it('preserves a returned action reference and never retries a failed attestation',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey,refs:string[]=[]
 const create=vi.spyOn(wallet,'createAction')
 vi.spyOn(wallet,'createSignature').mockRejectedValue(Error('declined'))
 await expect(issueTicketExperiment(wallet,identity,'event','ticket','run',r=>refs.push(r))).rejects.toThrow('declined')
 expect(create).toHaveBeenCalledTimes(1);expect(refs).toHaveLength(1)
})
it('refuses a transfer draft with an altered output before signing it',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','run')
 const create=wallet.createAction.bind(wallet)
 vi.spyOn(wallet,'createAction').mockImplementation(a=>create({...a,outputs:a.outputs?.map(o=>({...o,satoshis:2}))}))
 const sign=vi.spyOn(wallet,'signAction')
 await expect(transferTicketExperiment(wallet,prep)).rejects.toThrow()
 expect(sign).not.toHaveBeenCalled()
})
it('refuses a second ticket successor with a different receiving key before requesting a signature',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','run')
 const create=wallet.createAction.bind(wallet)
 vi.spyOn(wallet,'createAction').mockImplementation(a=>create({...a,outputs:[...a.outputs!,{lockingScript:ticketScript('event','ticket',prep.pkg.issuance.origin,prep.source).toHex(),satoshis:1,outputDescription:'Duplicate successor'}]}))
 const sign=vi.spyOn(wallet,'createSignature'),finalize=vi.spyOn(wallet,'signAction')
 await expect(transferTicketExperiment(wallet,prep)).rejects.toThrow()
 expect(sign).not.toHaveBeenCalled();expect(finalize).not.toHaveBeenCalled()
})
it('rejects a validly signed final transaction whose outputs differ from the approved draft',async()=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','run'),finalize=wallet.signAction.bind(wallet)
 vi.spyOn(wallet,'signAction').mockImplementation(async args=>{
  const response=await finalize(args),tx=Transaction.fromAtomicBEEF(response.tx!)
  tx.outputs.at(-1)!.satoshis!--
  tx.inputs[0].unlockingScript=await new PushDrop(wallet).unlock(RECEIVE_PROTOCOL,prep.source.requestId,'self','all',false).sign(tx,0)
  return {tx:tx.toAtomicBEEF(),txid:tx.id('hex')}
 })
 await expect(transferTicketExperiment(wallet,prep)).rejects.toThrow('differs from the approved draft')
})

async function recoveryFixture(){
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','recovery'),tx=Transaction.fromHex(prep.pkg.lineageRawTxs[0])
 const ticket={outpoint:`${tx.id('hex')}.0`,satoshis:1,lockingScript:tx.outputs[0].lockingScript.toHex(),spendable:true}
 const change={outpoint:`${tx.id('hex')}.1`,satoshis:9998,lockingScript:tx.outputs[1].lockingScript.toHex(),spendable:true}
 wallet.listOutputs=vi.fn(async args=>({totalOutputs:1,outputs:[args.basket==='counterfoil-ticket-experiment'?ticket:change]}))
 return {wallet,identity,prep,ticket,change}
}
it('restores transfer preparation only from wallet-confirmed ticket and managed change, without mutations',async()=>{
 const {wallet,identity,prep}=await recoveryFixture()
 const create=vi.spyOn(wallet,'createAction'),sign=vi.spyOn(wallet,'createSignature'),finalize=vi.spyOn(wallet,'signAction')
 const restored=await restoreTicketPreparation(wallet,prep.pkg,prep.destination,identity)
 expect(restored.source).toEqual(prep.source);expect(restored.destination).toEqual(prep.destination)
 expect(restored.noSendChange).toEqual([`${prep.pkg.current.txid}.1`])
 expect(wallet.listOutputs).toHaveBeenCalledWith({basket:'284570a6213a74ba861c38b1cf790e1e400d9cf9324454b76ea98860b6031c1a',include:'locking scripts',limit:1000})
 expect(create).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();expect(finalize).not.toHaveBeenCalled()
 const successor=await transferTicketExperiment(wallet,restored)
 expect(successor.lineageRawTxs).toHaveLength(2);expect(()=>verifyRecipient(successor,prep.destination)).not.toThrow()
})
it('rejects a substituted buyer key and a request that keeps the original holder',async()=>{
 const {wallet,identity,prep}=await recoveryFixture()
 await expect(restoreTicketPreparation(wallet,prep.pkg,{...prep.destination,recipient:prep.source.recipient},identity)).rejects.toThrow()
 await expect(restoreTicketPreparation(wallet,prep.pkg,prep.source,identity)).rejects.toThrow(/different/i)
})
it.each(['ticket absent','change absent','unspendable','wrong script','wrong value','ticket as change','duplicate','truncated'])('refuses recovery with %s wallet evidence',async mode=>{
 const {wallet,identity,prep,ticket,change}=await recoveryFixture()
 wallet.listOutputs=vi.fn(async args=>{
  let outputs=args.basket==='counterfoil-ticket-experiment'?[ticket]:[change]
  if(mode==='ticket absent'&&args.basket==='counterfoil-ticket-experiment')outputs=[]
  if(mode==='change absent'&&args.basket!=='counterfoil-ticket-experiment')outputs=[]
  if(mode==='unspendable')outputs=outputs.map(o=>({...o,spendable:false}))
  if(mode==='wrong script')outputs=outputs.map(o=>({...o,lockingScript:'51'}))
  if(mode==='wrong value')outputs=outputs.map(o=>({...o,satoshis:9}))
  if(mode==='ticket as change')outputs=[ticket]
  if(mode==='duplicate')outputs=[...outputs,...outputs]
  return {totalOutputs:mode==='truncated'?1001:outputs.length,outputs}
 })
 await expect(restoreTicketPreparation(wallet,prep.pkg,prep.destination,identity)).rejects.toThrow()
})
it('refuses restoration after the wallet changes profiles during output lookup',async()=>{
 const {wallet,identity,prep}=await recoveryFixture(),get=wallet.getPublicKey.bind(wallet),list=wallet.listOutputs.bind(wallet)
 wallet.listOutputs=vi.fn(async args=>{const result=await list(args);wallet.getPublicKey=async a=>a.identityKey?{publicKey:prep.destination.recipient.publicKey}:get(a);return result})
 await expect(restoreTicketPreparation(wallet,prep.pkg,prep.destination,identity)).rejects.toThrow(/identity/i)
})

it('rejects a mainnet wallet before querying recovery outputs',async()=>{
 const {wallet,identity,prep}=await recoveryFixture()
 wallet.getNetwork=async()=>({network:'mainnet'})
 await expect(restoreTicketPreparation(wallet,prep.pkg,prep.destination,identity)).rejects.toThrow(/testnet/i)
 expect(wallet.listOutputs).not.toHaveBeenCalled()
})
it('does not add unrelated wallet funds to the recovered noSendChange',async()=>{
 const {wallet,identity,prep,change}=await recoveryFixture(),list=wallet.listOutputs.bind(wallet)
 wallet.listOutputs=async args=>args.basket==='counterfoil-ticket-experiment'?list(args):{totalOutputs:2,outputs:[change,{...change,outpoint:`${'a'.repeat(64)}.0`}]}
 const restored=await restoreTicketPreparation(wallet,prep.pkg,prep.destination,identity)
 expect(restored.noSendChange).toEqual([`${prep.pkg.current.txid}.1`])
})
