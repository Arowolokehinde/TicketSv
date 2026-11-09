import {fetchPolicy,fetchStatus,postTransfer,checkPolicy,parseObservation} from '../settlement/arc.ts'
import {reviewConflictPair,verifyCompetingSpend} from './verify.ts'
import {reviewTransfer} from '../settlement/evidence.ts'
import {claimConflictStep,finishConflictStep,readConflictRun,type ConflictPersistence,type ConflictRecord} from './store.ts'
import type {ConflictBranch,ConflictPair,ConflictVerdict} from './types.ts'
import type {ArcObservation,ArcPolicy,TransferReview} from '../settlement/types.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {waitImport} from '../wallet/mined-import.ts'
export type ConflictSettlementDependencies=ConflictPersistence&{headers:()=>Promise<HeaderSnapshot|undefined>;policy:typeof fetchPolicy;status:typeof fetchStatus;post:typeof postTransfer}
export const conflictTransport={policy:fetchPolicy,status:fetchStatus,post:postTransfer}
export type ConflictSubmissionReview={run:ConflictRecord;branch:ConflictBranch;transfer:TransferReview;policy:ArcPolicy}
export function conflictPair(r:ConflictRecord):ConflictPair{if(!r.branches.a||!r.branches.b)throw new Error('Both complete signed branches are required');return {a:r.branches.a,b:r.branches.b}}
async function fresh(r:ConflictRecord,deps:ConflictPersistence,signal:AbortSignal){const current=await deps.load();signal.throwIfAborted();if(JSON.stringify(current)!==JSON.stringify(r))throw new Error('Conflict run changed; reload and review')}
function eligible(r:ConflictRecord,b:ConflictBranch){
 if(r.attempts.some(a=>a.outcome!=='complete'||a.phase===`submit-${b}`))throw new Error('Submission already attempted or an outcome is uncertain; check status without retrying')
 if(r.observations[b]?.some(o=>o.value&&o.value.txStatus!=='UNKNOWN'))throw new Error('Earlier provider observation blocks submission; review without retrying')
}
export async function reviewConflictSubmission(run:ConflictRecord,branch:ConflictBranch,signal:AbortSignal,deps:ConflictSettlementDependencies):Promise<ConflictSubmissionReview>{
 await fresh(run,deps,signal);eligible(run,branch)
 const snapshot=await deps.headers(),pair=conflictPair(run),checked=await reviewConflictPair(pair,snapshot)
 if(checked.verdict!=='verified')throw new Error(checked.reason)
 const transfer=await reviewTransfer(pair[branch],snapshot),policy=await waitImport(()=>deps.policy(signal),signal)
 checkPolicy(transfer,policy)
 // Review includes a read-only status query. Any known provider record blocks this initial send.
 const status=await waitImport(()=>deps.status(transfer.txid,signal),signal)
 if(status&&parseObservation(status,transfer.txid).txStatus!=='UNKNOWN')throw new Error('Provider already reports this branch; check and save its status, do not submit again')
 await fresh(run,deps,signal);return {run:structuredClone(run),branch,transfer,policy}
}
export async function submitConflictBranch(review:ConflictSubmissionReview,signal:AbortSignal,deps:ConflictSettlementDependencies){
 const freshReview=await reviewConflictSubmission(review.run,review.branch,signal,deps)
 if(JSON.stringify(freshReview)!==JSON.stringify(review))throw new Error('Policy, evidence or headers changed; review again')
 signal.throwIfAborted();const phase=`submit-${review.branch}` as const,claimed=claimConflictStep(review.run,phase)
 await deps.save(claimed,review.run.revision)
 let observation:ArcObservation|undefined
 try{
  await fresh(claimed,deps,signal)
  if((await deps.headers())?.id!==review.transfer.snapshotId)throw new Error('Headers changed before submission')
  signal.throwIfAborted();observation=parseObservation(await waitImport(()=>deps.post(review.transfer.efHex,review.transfer.txid,signal),signal),review.transfer.txid)
  signal.throwIfAborted()
 }catch{observation=undefined}
 const next=finishConflictStep(claimed,phase,observation?'complete':'unknown')
 if(observation)next.observations[review.branch]=[...(next.observations[review.branch]??[]).slice(-31),{checkedAt:new Date().toISOString(),value:observation}]
 await deps.save(readConflictRun(next),claimed.revision);return next
}
export async function checkConflictBranch(run:ConflictRecord,branch:ConflictBranch,signal:AbortSignal,deps:ConflictSettlementDependencies){
 await fresh(run,deps,signal);const e=run.branches[branch];if(!e)throw new Error('Signed branch missing')
 if(run.attempts.some(a=>a.outcome==='pending'&&Date.now()-Date.parse(a.startedAt)<60000))throw new Error('Wait at least 60 seconds before checking a pending attempt')
 const status=await waitImport(()=>deps.status(e.pkg.current.txid,signal),signal);signal.throwIfAborted()
 const value=status?parseObservation(status,e.pkg.current.txid):undefined
 const next=readConflictRun({...run,revision:run.revision+1,observations:{...run.observations,[branch]:[...(run.observations[branch]??[]).slice(-31),{checkedAt:new Date().toISOString(),value}]}})
 await deps.save(next,run.revision);return next
}
export async function verifyConflictSettlement(run:ConflictRecord,snapshot:HeaderSnapshot|undefined):Promise<Record<ConflictBranch,ConflictVerdict>>{
 const pair=conflictPair(run),result={} as Record<ConflictBranch,ConflictVerdict>
 for(const b of ['a','b'] as const){const latest=run.observations[b]?.at(-1)?.value;result[b]=latest?await verifyCompetingSpend(pair,b,latest,snapshot):{verdict:'incomplete',reason:'No current provider observation for this branch'}}
 if(result.a.verdict==='conflicting-spend-mined-in-local-snapshot'&&result.b.verdict==='conflicting-spend-mined-in-local-snapshot')return {a:{verdict:'rejected',reason:'Inconsistent competing mining evidence; manual chain review required'},b:{verdict:'rejected',reason:'Inconsistent competing mining evidence; manual chain review required'}}
 return result
}
