import type {WalletInterface,InternalizeActionArgs} from '@bsv/sdk'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {readReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import {fromBase64} from '../tickets/codec.ts'
import {reviewWalletImport,type ImportReview,type ImportReviewWallet} from './import-review.ts'
import {claimImport,loadImport,finishImport,observeImport,type ImportRecord} from './import-journal.ts'
export type ImportWallet=ImportReviewWallet&Pick<WalletInterface,'internalizeAction'>
export type ImportDependencies={source:()=>Promise<{evidence:ReopeningEvidence;snapshot:HeaderSnapshot|undefined}>;wallet:(signal:AbortSignal)=>Promise<ImportWallet>;load:typeof loadImport;claim:typeof claimImport;finish:typeof finishImport;observe:typeof observeImport;log?:(line:string)=>void}
export const importStore={load:loadImport,claim:claimImport,finish:finishImport,observe:observeImport}
export type MinedImportReview={evidence:ReopeningEvidence;wallet:ImportReview}
export function waitImport<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{
 const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason??new Error('Import operation cancelled'))}
 if(signal.aborted){abort();return}signal.addEventListener('abort',abort,{once:true})
 Promise.resolve().then(()=>{signal.throwIfAborted();return work()}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
})}
async function fresh(expected:ReopeningEvidence,signal:AbortSignal,deps:ImportDependencies,snapshotId?:string){
 const state=await deps.source();signal.throwIfAborted()
 if(JSON.stringify(readReopeningEvidence(state.evidence))!==JSON.stringify(expected)||snapshotId!==undefined&&state.snapshot?.id!==snapshotId)throw new Error('Saved evidence or headers changed. Review again before importing.')
 return state
}
async function inspect(expected:ReopeningEvidence,signal:AbortSignal,deps:ImportDependencies){
 const evidence=readReopeningEvidence(expected),state=await fresh(evidence,signal,deps)
 let client:ImportWallet|undefined
 const review=await reviewWalletImport(async()=>{client=await deps.wallet(signal);return client},evidence,state.snapshot,signal,deps.log)
 await fresh(evidence,signal,deps,review.snapshotId);signal.throwIfAborted()
 return {evidence,wallet:review,client:client!}
}
export function reviewMinedImport(evidence:ReopeningEvidence,signal:AbortSignal,deps:ImportDependencies):Promise<MinedImportReview>{return waitImport(async()=>{
 const r=await inspect(evidence,signal,deps)
 if(r.wallet.state!=='absent')throw new Error('Import requires an absent output in a complete wallet listing. Existing or inconclusive records need review.')
 return {evidence:r.evidence,wallet:r.wallet}
},signal)}
export function insertionArgs(value:ReopeningEvidence):InternalizeActionArgs{
 const e=readReopeningEvidence(value),key=e.buyer.recipient
 return {tx:fromBase64(e.pkg.atomicBeefBase64),outputs:[{outputIndex:e.pkg.current.index,protocol:'basket insertion',insertionRemittance:{basket:'counterfoil-ticket-experiment',customInstructions:JSON.stringify({protocolID:key.protocolID,keyID:key.keyID,counterparty:key.counterparty,type:'PushDrop'})}}],description:'Import mined Counterfoil ticket',seekPermission:true}
}
export async function importMinedTicket(reviewed:MinedImportReview,signal:AbortSignal,deps:ImportDependencies):Promise<ImportRecord>{
 const id=reviewed.evidence.pkg.current.txid
 if(await waitImport(()=>deps.load(id),signal))throw new Error('A wallet import was already attempted. Reconcile without retrying.')
 const r=await waitImport(()=>inspect(reviewed.evidence,signal,deps),signal)
 if(r.wallet.state!=='absent')throw new Error('Import requires an absent output. Review the existing or inconclusive record.')
 if(r.wallet.snapshotId!==reviewed.wallet.snapshotId)throw new Error('Headers changed; review again before importing')
 const args=insertionArgs(r.evidence);signal.throwIfAborted()
 // Atomic write completes before dispatch. If it stalls/finishes after cancellation,
 // the signal check below still prevents a wallet mutation; the claim remains protected.
 const record=await deps.claim(r.evidence)
 let outcome:'accepted'|'unknown'='unknown'
 try{
  await waitImport(()=>fresh(r.evidence,signal,deps,r.wallet.snapshotId),signal);signal.throwIfAborted()
  // Local persistence is asynchronous; recheck the selected wallet after the claim.
  // This cannot make a multi-call wallet API atomic, but it closes the storage gap.
  async function read<T>(method:string,fn:()=>Promise<T>){deps.log?.(`${method} — started`);const value=await waitImport(fn,signal);signal.throwIfAborted();deps.log?.(`${method} — returned`);return value}
  if((await read('getNetwork',()=>r.client.getNetwork({}))).network!=='testnet')throw new Error('Wallet network changed')
  if((await read('getPublicKey',()=>r.client.getPublicKey({identityKey:true}))).publicKey!==r.evidence.trusted)throw new Error('Wallet identity changed')
  const key=r.evidence.buyer.recipient
  if((await read('getPublicKey',()=>r.client.getPublicKey({protocolID:key.protocolID,keyID:key.keyID,counterparty:key.counterparty,forSelf:true}))).publicKey!==key.publicKey)throw new Error('Wallet receiving key changed')
  await waitImport(()=>fresh(r.evidence,signal,deps,r.wallet.snapshotId),signal);signal.throwIfAborted()
  deps.log?.('internalizeAction — started')
  const response=await waitImport(()=>r.client.internalizeAction(args),signal);signal.throwIfAborted()
  if(response?.accepted!==true)throw new Error('Unexpected import response')
  outcome='accepted';deps.log?.('internalizeAction — returned')
 }catch{deps.log?.('Import outcome uncertain — no retry permitted')}
 // Never turn a lost/late response into acceptance. A failed save leaves the durable
 // pending claim in place and blocks another import, including after page reload.
 return deps.finish(id,record.attempt.id,outcome)
}
export function reconcileMinedImport(evidence:ReopeningEvidence,signal:AbortSignal,deps:ImportDependencies):Promise<ImportRecord>{return waitImport(async()=>{
 const record=await deps.load(evidence.pkg.current.txid);signal.throwIfAborted()
 if(!record)throw new Error('No saved import attempt to reconcile')
 if(JSON.stringify(record.evidence)!==JSON.stringify(readReopeningEvidence(evidence)))throw new Error('Import evidence changed; inspect the saved diagnostic')
 if(record.attempt.outcome==='pending'&&Date.now()-Date.parse(record.attempt.startedAt)<60000)throw new Error('Wait at least 60 seconds before reconciling a pending import')
 const r=await inspect(evidence,signal,deps);signal.throwIfAborted()
 return deps.observe(evidence.pkg.current.txid,record.attempt.id,r.wallet)
},signal)}
