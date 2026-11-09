import {Transaction} from '@bsv/sdk'
import type {WalletInterface} from '@bsv/sdk'
import {readReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import {fromBase64} from '../tickets/codec.ts'
import {verifyTicket} from '../verification/verifyTicket.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'

export type ImportReviewWallet=Pick<WalletInterface,'getNetwork'|'getVersion'|'getPublicKey'|'listOutputs'>
export type ImportReview={state:'present'|'absent'|'inconclusive';reason:string;outpoint:string;requestId:string;walletIdentity:string;walletVersion:string;snapshotId:string;checkedAt:string}
function abortable<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason??new Error('Cancelled'))}
  if(signal.aborted){abort();return}
  signal.addEventListener('abort',abort,{once:true})
  Promise.resolve().then(()=>{signal.throwIfAborted();return work()}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
 })
}
// This review cannot import, sign, broadcast, or modify wallet records.
export function reviewWalletImport(loadWallet:()=>Promise<ImportReviewWallet>,value:ReopeningEvidence,snapshot:HeaderSnapshot|undefined,signal:AbortSignal,log:(entry:string)=>void=()=>{}):Promise<ImportReview>{
 return abortable(async()=>{
  const evidence=readReopeningEvidence(value),{pkg,buyer,trusted}=evidence
  const verified=await verifyTicket(pkg,{trustedVenueIdentity:trusted,expectedRequest:buyer,snapshot})
  if(verified.verdict!=='verified'||!verified.presentedTransferMined||!verified.snapshotId)throw new Error('Locally verified mined transfer required. Reverify mining in the settlement panel and sync missing headers first.')
  if(pkg.lineageRawTxs.length<2)throw new Error('A ticket transfer, not an issuance, is required')
  signal.throwIfAborted();const wallet=await loadWallet();signal.throwIfAborted()
  async function call<T>(method:string,work:()=>Promise<T>):Promise<T>{
   signal.throwIfAborted();log(`${method} — started`)
   try{const result=await abortable(work,signal);signal.throwIfAborted();log(`${method} — returned`);return result}
   catch(e){log(`${method} — failed`);throw e}
  }
  async function identity(){
   if((await call('getNetwork',()=>wallet.getNetwork({}))).network!=='testnet')throw new Error('Select testnet in the isolated wallet')
   if((await call('getPublicKey',()=>wallet.getPublicKey({identityKey:true}))).publicKey!==trusted)throw new Error('Wallet identity does not match the original same-wallet experiment')
  }
  await identity()
  const version=(await call('getVersion',()=>wallet.getVersion({}))).version
  if(typeof version!=='string'||version.length<7||version.length>30)throw new Error('Invalid wallet interface version')
  const key=buyer.recipient
  if((await call('getPublicKey',()=>wallet.getPublicKey({protocolID:key.protocolID,keyID:key.keyID,counterparty:key.counterparty,forSelf:true}))).publicKey!==key.publicKey)throw new Error('Wallet receiving key does not match the independently saved buyer request')
  const listing=await call('listOutputs',()=>wallet.listOutputs({basket:'counterfoil-ticket-experiment',include:'locking scripts',includeCustomInstructions:true,limit:1000}))
  await identity();signal.throwIfAborted()
  const base={outpoint:`${pkg.current.txid}.${pkg.current.index}`,requestId:buyer.requestId,walletIdentity:trusted,walletVersion:version,snapshotId:verified.snapshotId,checkedAt:new Date().toISOString()}
  const inconclusive=(reason:string):ImportReview=>({...base,state:'inconclusive',reason})
  if(!listing||!Number.isSafeInteger(listing.totalOutputs)||listing.totalOutputs<0||listing.totalOutputs>1000||!Array.isArray(listing.outputs)||listing.outputs.length!==listing.totalOutputs)return inconclusive('Wallet listing is incomplete or exceeds this experiment’s 1,000-output limit. No absence or import conclusion is available.')
  const seen=new Set<string>()
  for(const output of listing.outputs){
   if(!output||typeof output.outpoint!=='string'||! /^[0-9a-f]{64}\.(0|[1-9][0-9]{0,9})$/.test(output.outpoint)||Number(output.outpoint.split('.')[1])>0xffffffff||seen.has(output.outpoint))return inconclusive('Wallet listing contains invalid or duplicate outpoints.')
   seen.add(output.outpoint)
  }
  const match=listing.outputs.find(o=>o.outpoint===base.outpoint)
  if(!match)return {...base,state:'absent',reason:'The exact output was not listed in this basket. This does not prove there is no wallet action or authorize an import retry.'}
  const expected=Transaction.fromAtomicBEEF(fromBase64(pkg.atomicBeefBase64)).outputs[pkg.current.index]
  if(!expected||match.spendable!==true||match.satoshis!==expected.satoshis||match.lockingScript!==expected.lockingScript.toHex())return inconclusive('Wallet output amount, script or spendable report does not match the reviewed ticket.')
  try{
   if(typeof match.customInstructions!=='string'||match.customInstructions.length>10000)throw new Error('missing')
   const instructions=JSON.parse(match.customInstructions)
   if(!instructions||instructions.type!=='PushDrop'||instructions.keyID!==key.keyID||instructions.counterparty!==key.counterparty||JSON.stringify(instructions.protocolID)!==JSON.stringify(key.protocolID))throw new Error('mismatch')
  }catch{return inconclusive('Receiving-key instructions are missing or differ. Review wallet records before considering import.')}
  return {...base,state:'present',reason:'This read-only check found a matching ticket output in the experiment basket. The check itself made no wallet changes; any import response is recorded separately. This observation does not establish current chain unspentness.'}
 },signal)
}
