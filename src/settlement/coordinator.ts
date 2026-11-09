import {fetchPolicy,fetchStatus,postTransfer,parseObservation,checkPolicy} from './arc.ts'
import {reviewTransfer} from './evidence.ts'
import {claimSubmission,saveSettlement,readSettlement,ensureAttemptIdle} from './store.ts'
import {loadSnapshot} from '../headers/store.ts'
import type {ArcObservation,ArcPolicy,SettlementRecord,TransferReview} from './types.ts'
type Dependencies={review:(r:TransferReview)=>Promise<TransferReview>;policy:(signal:AbortSignal)=>Promise<ArcPolicy>;post:(ef:string,id:string,signal:AbortSignal)=>Promise<ArcObservation>;claim:(r:TransferReview,revision:number|undefined,retry:boolean)=>Promise<SettlementRecord>;save:(r:SettlementRecord,revision:number)=>Promise<void>;status:(id:string,signal:AbortSignal)=>Promise<ArcObservation|undefined>}
export const defaultSettlementDependencies:Dependencies={review:async r=>reviewTransfer(r.evidence,await loadSnapshot()),policy:fetchPolicy,post:postTransfer,claim:claimSubmission,save:saveSettlement,status:fetchStatus}
export async function submitReviewedTransfer(review:TransferReview,revision:number|undefined,signal:AbortSignal,retry=false,deps:Dependencies=defaultSettlementDependencies):Promise<SettlementRecord>{
 signal.throwIfAborted();const fresh=await deps.review(review);signal.throwIfAborted()
 if(JSON.stringify(fresh)!==JSON.stringify(review))throw new Error('Reviewed evidence or headers changed; review again')
 checkPolicy(fresh,await deps.policy(signal));signal.throwIfAborted()
 const finalReview=await deps.review(review);signal.throwIfAborted()
 if(JSON.stringify(finalReview)!==JSON.stringify(review))throw new Error('Reviewed evidence or headers changed; review again')
 const claimed=await deps.claim(fresh,revision,retry)
 let observation:ArcObservation|undefined,error:string|undefined
 try{
  signal.throwIfAborted()
  observation=parseObservation(await deps.post(fresh.efHex,fresh.txid,signal),fresh.txid)
  signal.throwIfAborted()
 }catch{error='Submission outcome unknown. Check transfer status before considering an identical-byte retry.'}
 const next=readSettlement({...claimed,revision:claimed.revision+1,lastStatus:observation,attempts:claimed.attempts.map((a,i)=>i===claimed.attempts.length-1?{...a,outcome:observation?'response':'unknown',finishedAt:new Date().toISOString(),observation,error}:a)})
 try{await deps.save(next,claimed.revision)}catch{throw new Error('Could not save submission response; outcome unknown. The pending attempt remains for review.')}
 return next
}
export async function reconcileSettlement(value:SettlementRecord,signal:AbortSignal,deps:Pick<Dependencies,'status'|'save'>=defaultSettlementDependencies):Promise<SettlementRecord>{
 const record=readSettlement(value);ensureAttemptIdle(record);signal.throwIfAborted();const status=await deps.status(record.txid,signal);signal.throwIfAborted()
 const observed=status?parseObservation(status,record.txid):undefined,checkedAt=new Date().toISOString()
 const next=readSettlement({...record,revision:record.revision+1,lastStatus:observed,candidate:undefined,reconciledAttemptId:record.attempts.at(-1)?.id,lastStatusCheckedAt:checkedAt,statusChecks:[...record.statusChecks.slice(-31),{checkedAt,observation:observed}]})
 await deps.save(next,record.revision);return next
}
