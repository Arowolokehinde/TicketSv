import {KeyDeriver,PushDrop,Transaction,Utils} from '@bsv/sdk'
import type {WalletInterface} from '@bsv/sdk'
import {identifier,publicKey,readTicketPackage,readReceiveRequest,fromBase64} from '../tickets/codec.ts'
import {decodeTicket,issuanceBytes,ticketScript} from '../tickets/script.ts'
import {ISSUER_PROTOCOL,RECEIVE_PROTOCOL} from '../tickets/types.ts'
import type {TicketPackage,ReceiveRequest} from '../tickets/types.ts'
import {verifyIssuer,verifyContinuity,verifyRecipient} from '../verification/authenticity.ts'
import {inspectFinal,inspectSource,readSigningDraft,transactionIntent} from './signing-experiment.ts'
export type TicketPreparation={pkg:TicketPackage;source:ReceiveRequest;destination:ReceiveRequest;noSendChange:string[]}
type PublicWallet=Pick<WalletInterface,'getNetwork'|'getPublicKey'>
async function identity(wallet:PublicWallet,expected:string):Promise<void>{
 if((await wallet.getNetwork({})).network!=='testnet')throw new Error('Select testnet for ticket experiments')
 if((await wallet.getPublicKey({identityKey:true})).publicKey!==publicKey(expected))throw new Error('Wallet identity does not match the configured venue')
}
async function receive(wallet:PublicWallet,requestId:string):Promise<ReceiveRequest>{
 identifier(requestId)
 const key=publicKey((await wallet.getPublicKey({protocolID:RECEIVE_PROTOCOL,keyID:requestId,counterparty:'self',forSelf:true})).publicKey)
 return {kind:'ticket-request',version:1,network:'testnet',requestId,recipient:{publicKey:key,protocolID:[...RECEIVE_PROTOCOL],keyID:requestId,counterparty:'self'}}
}
// Recovery is deliberately limited to this same-wallet issuance experiment.
// The package supplies a lookup ID; the wallet must independently return the
// matching public key. This is not recovery of a buyer's pre-handoff intent.
export async function confirmIssuanceRequest(wallet:PublicWallet,value:TicketPackage,trusted:string):Promise<ReceiveRequest>{
 const pkg=readTicketPackage(JSON.stringify(value))
 if(pkg.lineageRawTxs.length!==1||pkg.current.txid!==pkg.issuance.origin.txid||pkg.current.index!==pkg.issuance.origin.index)throw new Error('Request recovery is limited to the original issuance')
 verifyIssuer(pkg,trusted);verifyContinuity(pkg)
 const tx=Transaction.fromHex(pkg.lineageRawTxs[0]),ticket=decodeTicket(tx.outputs[pkg.current.index].lockingScript)
 if(!ticket)throw new Error('Issuance ticket script is missing')
 await identity(wallet,trusted)
 const request=await receive(wallet,ticket.requestId)
 await identity(wallet,trusted)
 verifyRecipient(pkg,request)
 return request
}
// wallet-toolbox 2.14.9's read-only specOpWalletManagedUtxos, verified in the
// pinned isolated Desktop build. Unlike the ordinary default basket, this
// selects wallet-managed fee change, including unconsumed staged outputs.
// Do not substitute a plain default-basket query or guess change from tx bytes.
const MANAGED_CHANGE_BASKET='284570a6213a74ba861c38b1cf790e1e400d9cf9324454b76ea98860b6031c1a'
export async function restoreTicketPreparation(wallet:PublicWallet&Pick<WalletInterface,'listOutputs'>,value:TicketPackage,buyer:ReceiveRequest,trusted:string):Promise<TicketPreparation>{
 const pkg=readTicketPackage(JSON.stringify(value)),destination=readReceiveRequest(JSON.stringify(buyer))
 const source=await confirmIssuanceRequest(wallet,pkg,trusted)
 if(destination.requestId===source.requestId||destination.recipient.publicKey===source.recipient.publicKey)throw new Error('Choose the different, independently saved prepared buyer request')
 const actual=await receive(wallet,destination.requestId)
 if(JSON.stringify(actual)!==JSON.stringify(destination))throw new Error('Prepared buyer request does not match this wallet')
 const tx=Transaction.fromAtomicBEEF(fromBase64(pkg.atomicBeefBase64))
 await inspectFinal({tx:fromBase64(pkg.atomicBeefBase64),txid:pkg.current.txid},tx.outputs[pkg.current.index].lockingScript.toHex())
 const outpoint=`${pkg.current.txid}.${pkg.current.index}`
 async function listed(basket:string){
  await identity(wallet,trusted)
  const result=await wallet.listOutputs({basket,include:'locking scripts',limit:1000})
  await identity(wallet,trusted)
  if(!Number.isSafeInteger(result.totalOutputs)||result.totalOutputs<0||result.totalOutputs>1000||result.outputs.length!==result.totalOutputs)throw new Error('Wallet output listing is incomplete; review wallet state before restoring')
  const seen=new Set<string>()
  for(const output of result.outputs){
   if(seen.has(output.outpoint))throw new Error('Wallet returned duplicate outputs')
   seen.add(output.outpoint)
  }
  return result.outputs.filter(output=>output.outpoint.startsWith(`${pkg.current.txid}.`)).map(output=>{
   const suffix=output.outpoint.slice(pkg.current.txid.length+1),index=Number(suffix),original=tx.outputs[index]
   if(!Number.isSafeInteger(index)||index<0||String(index)!==suffix||!original||output.spendable!==true||output.satoshis!==original.satoshis||output.lockingScript!==original.lockingScript.toHex())throw new Error('Wallet output does not match the available issuance output')
   return output.outpoint
  })
 }
 const tickets=await listed('counterfoil-ticket-experiment')
 if(!tickets.includes(outpoint))throw new Error('Original ticket is not listed as spendable; review pending wallet actions')
 const noSendChange=await listed(MANAGED_CHANGE_BASKET)
 if(!noSendChange.length||noSendChange.includes(outpoint))throw new Error('Required managed change is unavailable; keep the isolated wallet running and review its pending actions')
 return {pkg,source,destination,noSendChange}
}
export async function issueTicketExperiment(wallet:WalletInterface,trusted:string,eventId:string,ticketId:string,runId:string,onReference:(r:string)=>void=()=>{},mode:'staged'|'broadcast'='staged'):Promise<TicketPreparation>{
 identifier(eventId);identifier(ticketId);identifier(runId);await identity(wallet,trusted)
 const source=await receive(wallet,`${runId}-source`),destination=await receive(wallet,`${runId}-buyer`)
 const script=ticketScript(eventId,ticketId,null,source).toHex()
 await identity(wallet,trusted)
 const response=await wallet.createAction({description:'Issue Counterfoil authenticity test ticket',labels:[`counterfoil-issuance-${runId}`],outputs:[{lockingScript:script,satoshis:1,outputDescription:'Self-owned venue ticket experiment',basket:'counterfoil-ticket-experiment',customInstructions:JSON.stringify({protocolID:RECEIVE_PROTOCOL,keyID:source.requestId,counterparty:'self',type:'PushDrop'})}],options:{noSend:mode==='staged',...(mode==='broadcast'?{acceptDelayedBroadcast:false}:{}),returnTXIDOnly:false,randomizeOutputs:false}})
 const ref=response.signableTransaction?.reference??response.txid;if(ref)onReference(ref)
 const final=await inspectFinal(response,script),origin={txid:final.txid,index:final.outputIndex}
 await identity(wallet,trusted)
 const data=issuanceBytes(eventId,ticketId,origin),keyID=`${origin.txid}.${origin.index}`
 const signature=(await wallet.createSignature({protocolID:ISSUER_PROTOCOL,keyID,counterparty:'anyone',data})).signature
 await identity(wallet,trusted)
 const pkg=readTicketPackage(JSON.stringify({kind:'ticket-package',version:1,network:'testnet',issuance:{eventId,ticketId,origin,issuerIdentity:trusted,signedBytesBase64:Utils.toBase64(data),signatureBase64:Utils.toBase64(signature),signingKey:{publicKey:new KeyDeriver('anyone').derivePublicKey(ISSUER_PROTOCOL,keyID,trusted).toString(),protocolID:ISSUER_PROTOCOL,keyID,counterparty:'anyone'}},current:origin,request:source,lineageRawTxs:[Transaction.fromAtomicBEEF(final.atomicBeef).toHex()],atomicBeefBase64:Utils.toBase64(final.atomicBeef)}))
 verifyIssuer(pkg,trusted);verifyContinuity(pkg);verifyRecipient(pkg,source)
 return {pkg,source,destination,noSendChange:mode==='staged'?(response.noSendChange??[]):[]}
}
export async function transferTicketExperiment(wallet:WalletInterface,prep:TicketPreparation,onReference:(r:string)=>void=()=>{}):Promise<TicketPackage>{
 const pkg=readTicketPackage(JSON.stringify(prep.pkg)),trusted=pkg.issuance.issuerIdentity
 await identity(wallet,trusted);verifyIssuer(pkg,trusted);verifyContinuity(pkg);verifyRecipient(pkg,prep.source)
 if(pkg.current.txid!==pkg.issuance.origin.txid)throw new Error('This diagnostic transfers only its fresh issuance')
 for(const request of [prep.source,prep.destination]){const actual=await receive(wallet,request.requestId);if(JSON.stringify(actual)!==JSON.stringify(request))throw new Error('Prepared receiving key changed')}
 const original=Transaction.fromAtomicBEEF(fromBase64(pkg.atomicBeefBase64)),script=ticketScript(pkg.issuance.eventId,pkg.issuance.ticketId,pkg.issuance.origin,prep.destination).toHex()
 await inspectSource({tx:fromBase64(pkg.atomicBeefBase64),txid:pkg.current.txid},original.outputs[pkg.current.index].lockingScript.toHex())
 await identity(wallet,trusted)
 const response=await wallet.createAction({description:'Transfer Counterfoil authenticity test ticket',inputBEEF:fromBase64(pkg.atomicBeefBase64),inputs:[{outpoint:`${pkg.current.txid}.${pkg.current.index}`,inputDescription:'Self-owned venue experiment ticket',unlockingScriptLength:73}],outputs:[{lockingScript:script,satoshis:1,outputDescription:'Self-owned successor ticket',basket:'counterfoil-ticket-experiment',customInstructions:JSON.stringify({protocolID:RECEIVE_PROTOCOL,keyID:prep.destination.requestId,counterparty:'self',type:'PushDrop'})}],options:{noSend:true,signAndProcess:false,returnTXIDOnly:false,randomizeOutputs:false,noSendChange:prep.noSendChange}})
 const signable=response.signableTransaction;if(!signable?.reference)throw new Error('Wallet did not return a signing draft');onReference(signable.reference)
 const draft=readSigningDraft(signable.tx),indices=draft.inputs.flatMap((i,n)=>i.sourceTXID===pkg.current.txid&&i.sourceOutputIndex===pkg.current.index?[n]:[])
 if(indices.length!==1||draft.inputs[indices[0]].sourceTransaction!.toHex()!==original.toHex())throw new Error('Draft changed the prepared source')
 const matches=draft.outputs.filter(o=>o.lockingScript.toHex()===script);if(matches.length!==1||matches[0].satoshis!==1)throw new Error('Draft changed the expected ticket output')
 const successors=draft.outputs.filter(o=>{const ticket=decodeTicket(o.lockingScript);return ticket?.eventId===pkg.issuance.eventId&&ticket.ticketId===pkg.issuance.ticketId})
 if(successors.length!==1)throw new Error('Draft contains duplicate ticket successors')
 const intent=transactionIntent(draft);await identity(wallet,trusted)
 const unlocking=await new PushDrop(wallet).unlock(RECEIVE_PROTOCOL,prep.source.requestId,'self','all',false).sign(draft,indices[0])
 await identity(wallet,trusted)
 const signed=await wallet.signAction({reference:signable.reference,spends:{[indices[0]]:{unlockingScript:unlocking.toHex()}},options:{noSend:true,returnTXIDOnly:false}})
 const final=await inspectFinal(signed,script),tx=Transaction.fromAtomicBEEF(final.atomicBeef)
 if(transactionIntent(tx)!==intent)throw new Error('Final transaction differs from the approved draft')
 await identity(wallet,trusted)
 const result=readTicketPackage(JSON.stringify({...pkg,current:{txid:final.txid,index:final.outputIndex},request:prep.destination,lineageRawTxs:[...pkg.lineageRawTxs,tx.toHex()],atomicBeefBase64:Utils.toBase64(final.atomicBeef)}))
 verifyIssuer(result,trusted);verifyContinuity(result);verifyRecipient(result,prep.destination);return result
}
