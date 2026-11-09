import {Beef,KeyDeriver,LockingScript,OP,PushDrop,Transaction,Utils} from '@bsv/sdk'
import type {WalletInterface} from '@bsv/sdk'
import {claimConflictStep,finishConflictStep,readConflictRun,type ConflictRecord,type ConflictPersistence,type ConflictPhase} from '../conflicts/store.ts'
import {readReceiveRequest,readTicketPackage,fromBase64,publicKey} from '../tickets/codec.ts'
import {ticketScript,issuanceBytes} from '../tickets/script.ts'
import {ISSUER_PROTOCOL,RECEIVE_PROTOCOL,type KeyBinding,type ReceiveRequest} from '../tickets/types.ts'
import {verifyIssuer,verifyContinuity,verifyRecipient} from '../verification/authenticity.ts'
import {verifyTicket} from '../verification/verifyTicket.ts'
import {readSigningEvidenceBytes,verifySigningEvidence} from '../verification/signing-spv.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {inspectFinal} from './signing-experiment.ts'
import {waitImport} from './mined-import.ts'
import type {ConflictBranch} from '../conflicts/types.ts'
export type ConflictSigningReview={record:ConflictRecord;snapshotId:string}
const FEE_PROTOCOL:[2,string]=[2,'counterfoil conflict fees']
export function feeScript(runId:string,branch:ConflictBranch,key:KeyBinding):LockingScript{return new LockingScript().writeBin(Utils.toArray(key.publicKey,'hex')).writeOpCode(OP.OP_CHECKSIG).writeBin([...new TextEncoder().encode(JSON.stringify(['counterfoil-conflict-fee',1,runId,branch]))]).writeOpCode(OP.OP_DROP) as LockingScript}
async function identity(wallet:WalletInterface,r:ConflictRecord,signal:AbortSignal){
 if((await waitImport(()=>wallet.getNetwork({}),signal)).network!=='testnet')throw new Error('Select the isolated testnet wallet')
 if((await waitImport(()=>wallet.getPublicKey({identityKey:true}),signal)).publicKey!==r.trusted)throw new Error('Wallet identity changed')
 signal.throwIfAborted()
}
async function same(r:ConflictRecord,store:ConflictPersistence){const current=await store.load();if(JSON.stringify(current)!==JSON.stringify(r))throw new Error('Conflict run changed; reload and review');return current}
async function save(next:ConflictRecord,old:ConflictRecord,store:ConflictPersistence){await store.save(next,old.revision);return next}
async function phase(r:ConflictRecord,name:ConflictPhase,signal:AbortSignal,store:ConflictPersistence,work:(claimed:ConflictRecord)=>Promise<Partial<Pick<ConflictRecord,'issued'|'issuance'|'branches'>>>){
 await same(r,store);signal.throwIfAborted();const claimed=claimConflictStep(r,name);await save(claimed,r,store)
 try{signal.throwIfAborted();const patch=await work(claimed);signal.throwIfAborted();return await save(finishConflictStep(claimed,name,'complete',patch),claimed,store)}
 catch(e){try{await save(finishConflictStep(claimed,name,'unknown'),claimed,store)}catch{/* A failed final write keeps the pending claim; never retry. */}throw e}
}
async function receive(wallet:WalletInterface,id:string,signal:AbortSignal):Promise<ReceiveRequest>{const publicKey=(await waitImport(()=>wallet.getPublicKey({protocolID:RECEIVE_PROTOCOL,keyID:id,counterparty:'self',forSelf:true}),signal)).publicKey;return readReceiveRequest(JSON.stringify({kind:'ticket-request',version:1,network:'testnet',requestId:id,recipient:{publicKey,protocolID:RECEIVE_PROTOCOL,keyID:id,counterparty:'self'}}))}
async function keysMatch(wallet:WalletInterface,r:ConflictRecord,signal:AbortSignal){
 await identity(wallet,r,signal);if(!r.keys)throw new Error('Prepared keys missing')
 for(const k of [r.keys.source.recipient,r.keys.a.recipient,r.keys.b.recipient,r.keys.fees.a,r.keys.fees.b]){
  const actual=await waitImport(()=>wallet.getPublicKey({protocolID:k.protocolID,keyID:k.keyID,counterparty:k.counterparty,forSelf:true}),signal)
  if(actual.publicKey!==k.publicKey)throw new Error('Prepared receiving or fee key changed')
 }
 await identity(wallet,r,signal)
}
function sourceTransaction(r:ConflictRecord){
 if(!r.issuance||!r.keys)throw new Error('Issuance evidence missing')
 verifyIssuer(r.issuance,r.trusted);verifyContinuity(r.issuance);verifyRecipient(r.issuance,r.keys.source)
 const tx=Transaction.fromAtomicBEEF(fromBase64(r.issuance.atomicBeefBase64))
 if(tx.toHex()!==r.issuance.lineageRawTxs[0]||tx.id('hex')!==r.issued?.txid)throw new Error('Issuance bytes changed')
 for(const [index,script,amount] of [[0,ticketScript(r.eventId,r.ticketId,null,r.keys.source),1],[1,feeScript(r.id,'a',r.keys.fees.a),1000],[2,feeScript(r.id,'b',r.keys.fees.b),1000]] as const){const o=tx.outputs[index];if(o?.satoshis!==amount||o.lockingScript.toHex()!==script.toHex())throw new Error('Dedicated fixture output changed')}
 return tx
}
export async function issueConflictFixture(wallet:WalletInterface,value:ConflictRecord,signal:AbortSignal,store:ConflictPersistence){
 let r=readConflictRun(value);await same(r,store);if(r.attempts.length||r.issued)throw new Error('Issuance already attempted; do not retry')
 await identity(wallet,r,signal)
 if(!r.keys){
  const source=await receive(wallet,`${r.id}-source`,signal),a=await receive(wallet,`${r.id}-a`,signal),b=await receive(wallet,`${r.id}-b`,signal)
  const fees={} as Record<ConflictBranch,KeyBinding>
  for(const name of ['a','b'] as const){const keyID=`${r.id}-fee-${name}`,key=publicKey((await waitImport(()=>wallet.getPublicKey({protocolID:FEE_PROTOCOL,keyID,counterparty:'self',forSelf:true}),signal)).publicKey);fees[name]={publicKey:key,protocolID:FEE_PROTOCOL,keyID,counterparty:'self'}}
  signal.throwIfAborted();r=await save(readConflictRun({...r,revision:r.revision+1,keys:{source,a,b,fees}}),r,store)
 }
 const keys=r.keys!,scripts=[ticketScript(r.eventId,r.ticketId,null,keys.source),feeScript(r.id,'a',keys.fees.a),feeScript(r.id,'b',keys.fees.b)]
 r=await phase(r,'issue',signal,store,async claimed=>{
  await keysMatch(wallet,claimed,signal);await same(claimed,store);signal.throwIfAborted()
  const result=await waitImport(()=>wallet.createAction({description:'Issue separate Counterfoil conflicting-transfer fixture',labels:[`counterfoil-conflict-${r.id}`],outputs:scripts.map((script,index)=>({lockingScript:script.toHex(),satoshis:index===0?1:1000,outputDescription:index===0?'Separate conflict test ticket':`Dedicated conflict fee ${index}`,basket:index===0?'counterfoil-conflict-ticket':'counterfoil-conflict-fees',customInstructions:JSON.stringify({... (index===0?keys.source.recipient:keys.fees[index===1?'a':'b']),type:'PushDrop'})})),options:{noSend:false,acceptDelayedBroadcast:false,returnTXIDOnly:false,randomizeOutputs:false}}),signal)
  // Persist any returned reference even if validation/attestation subsequently fails.
  const reference=result.signableTransaction?.reference??result.txid
  const returnedBytes=result.tx??result.signableTransaction?.tx
  const returned={...(result.txid&&/^[0-9a-f]{64}$/.test(result.txid)?{txid:result.txid}:{}),...(returnedBytes&&returnedBytes.length<=4*1024*1024&&returnedBytes.every(v=>Number.isInteger(v)&&v>=0&&v<=255)?{atomicBeefBase64:Utils.toBase64(returnedBytes)}:{})}
  const receipt=readConflictRun({...claimed,revision:claimed.revision+1,attempts:claimed.attempts.map((a,i)=>i===claimed.attempts.length-1?{...a,...(reference?{reference}:{}),returned}:a)})
  await save(receipt,claimed,store)
  Object.assign(claimed,receipt) // Later completion/uncertainty must use the persisted receipt revision.
  signal.throwIfAborted()
  const final=await inspectFinal(result,scripts[0].toHex()),tx=Transaction.fromAtomicBEEF(final.atomicBeef)
  if(final.outputIndex!==0||scripts.some((s,i)=>tx.outputs[i]?.lockingScript.toHex()!==s.toHex()||tx.outputs[i]?.satoshis!==(i===0?1:1000)))throw new Error('Wallet changed fixture outputs')
  await identity(wallet,claimed,signal)
  return {issued:{txid:final.txid,atomicBeefBase64:Utils.toBase64(final.atomicBeef)}}
 })
 r=await phase(r,'attest',signal,store,async claimed=>{
  await identity(wallet,claimed,signal);await same(claimed,store)
  const origin={txid:claimed.issued!.txid,index:0},keyID=`${origin.txid}.0`,data=issuanceBytes(r.eventId,r.ticketId,origin)
  const {signature}=await waitImport(()=>wallet.createSignature({protocolID:ISSUER_PROTOCOL,keyID,counterparty:'anyone',data}),signal)
  await identity(wallet,claimed,signal)
  const pkg=readTicketPackage(JSON.stringify({kind:'ticket-package',version:1,network:'testnet',issuance:{eventId:r.eventId,ticketId:r.ticketId,origin,issuerIdentity:r.trusted,signedBytesBase64:Utils.toBase64(data),signatureBase64:Utils.toBase64(signature),signingKey:{publicKey:new KeyDeriver('anyone').derivePublicKey(ISSUER_PROTOCOL,keyID,r.trusted).toString(),protocolID:ISSUER_PROTOCOL,keyID,counterparty:'anyone'}},current:origin,request:keys.source,lineageRawTxs:[Transaction.fromAtomicBEEF(fromBase64(claimed.issued!.atomicBeefBase64)).toHex()],atomicBeefBase64:claimed.issued!.atomicBeefBase64}))
  verifyIssuer(pkg,r.trusted);verifyContinuity(pkg);return {issuance:pkg}
 })
 return r
}
export async function refreshConflictIssuance(wallet:WalletInterface,value:ConflictRecord,signal:AbortSignal){
 const r=readConflictRun(value),old=sourceTransaction(r);await keysMatch(wallet,r,signal)
 const result=await waitImport(()=>wallet.listOutputs({basket:'counterfoil-conflict-ticket',include:'entire transactions',limit:1000}),signal);await identity(wallet,r,signal)
 if(!Number.isSafeInteger(result.totalOutputs)||result.totalOutputs>1000||result.totalOutputs<0||result.outputs.length!==result.totalOutputs||!result.BEEF)throw new Error('Incomplete conflict wallet evidence')
 const matches=result.outputs.filter(o=>o.outpoint===`${old.id('hex')}.0`)
 if(matches.length!==1||!matches[0].spendable||matches[0].satoshis!==1)throw new Error('Fresh ticket output is not listed as available')
 const beef=Beef.fromBinary(result.BEEF);if(beef.txs.length>128||!beef.isValid(false))throw new Error('Incomplete BEEF')
 const bytes=beef.toBinaryAtomic(old.id('hex')),tx=Transaction.fromAtomicBEEF(bytes)
 if(tx.toHex()!==old.toHex()||!tx.merklePath)throw new Error('Exact issuance mining evidence not available yet')
 readSigningEvidenceBytes(old.id('hex'),bytes)
 return readTicketPackage(JSON.stringify({...r.issuance,atomicBeefBase64:Utils.toBase64(bytes)}))
}
export async function prepareConflictSigning(wallet:WalletInterface,value:ConflictRecord,snapshot:HeaderSnapshot|undefined,signal:AbortSignal):Promise<ConflictSigningReview>{
 const r=readConflictRun(value);if(r.attempts.some(a=>a.outcome!=='complete'||a.phase.startsWith('sign-')||a.phase.startsWith('submit-')))throw new Error('Signing already attempted or wallet outcome uncertain')
 const tx=sourceTransaction(r),report=await verifySigningEvidence(readSigningEvidenceBytes(tx.id('hex'),fromBase64(r.issuance!.atomicBeefBase64)),snapshot)
 if(!report.subjectMined)throw new Error('Locally verified mined issuance required')
 await keysMatch(wallet,r,signal);signal.throwIfAborted();return {record:r,snapshotId:report.snapshotId}
}
export async function signConflictBranches(wallet:WalletInterface,review:ConflictSigningReview,signal:AbortSignal,store:ConflictPersistence,headers:()=>Promise<HeaderSnapshot|undefined>){
 let r=readConflictRun(review.record);await same(r,store)
 const snapshot=await headers();if(!snapshot||snapshot.id!==review.snapshotId)throw new Error('Headers changed; prepare again')
 await prepareConflictSigning(wallet,r,snapshot,signal)
 for(const branch of ['a','b'] as const){
  r=await phase(r,`sign-${branch}`,signal,store,async claimed=>{
   const source=sourceTransaction(claimed),buyer=claimed.keys![branch],tx=new Transaction(1,[{sourceTransaction:source,sourceOutputIndex:0,sequence:0xffffffff},{sourceTransaction:source,sourceOutputIndex:branch==='a'?1:2,sequence:0xffffffff}],[{satoshis:1,lockingScript:ticketScript(r.eventId,r.ticketId,r.issuance!.issuance.origin,buyer)}],0)
   for(const [index,key] of [claimed.keys!.source.recipient,claimed.keys!.fees[branch]].entries()){
    await keysMatch(wallet,claimed,signal);await same(claimed,store)
    if((await headers())?.id!==review.snapshotId)throw new Error('Headers changed during signing')
    signal.throwIfAborted();tx.inputs[index].unlockingScript=await waitImport(()=>new PushDrop(wallet).unlock(key.protocolID,key.keyID,key.counterparty,'all',false).sign(tx,index),signal)
    await identity(wallet,claimed,signal)
   }
   const pkg=readTicketPackage(JSON.stringify({...r.issuance,current:{txid:tx.id('hex'),index:0},request:buyer,lineageRawTxs:[source.toHex(),tx.toHex()],atomicBeefBase64:Utils.toBase64(tx.toAtomicBEEF())}))
   const checked=await verifyTicket(pkg,{trustedVenueIdentity:r.trusted,expectedRequest:buyer,snapshot})
   if(checked.verdict!=='verified')throw new Error('Signed branch failed local verification')
   return {branches:{...claimed.branches,[branch]:{kind:'counterfoil-reopening-evidence',version:1,trusted:r.trusted,pkg,buyer}}}
  })
 }
 return r
}
