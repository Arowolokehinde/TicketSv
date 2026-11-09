import {ARC_TESTNET,type ArcObservation,type SettlementRecord,type TransferReview,type SubmissionAttempt} from './types.ts'
import {readReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import {transactionSummary} from './evidence.ts'
import {parseObservation} from './arc.ts'
const DB='counterfoil-arc-experiment-v1'
function date(v:unknown):string{if(typeof v!=='string'||v.length>40||!Number.isFinite(Date.parse(v)))throw new Error('Invalid settlement date');return v}
function identifier(v:unknown):string{if(typeof v!=='string'||!v.length||v.length>128)throw new Error('Invalid settlement identifier');return v}
function storedObservation(v:ArcObservation,id:string):ArcObservation{return {...parseObservation(v,id),observedAt:date(v.observedAt)}}
export function readSettlement(value:unknown):SettlementRecord{
 if(!value||typeof value!=='object'||JSON.stringify(value).length>32*1024*1024)throw new Error('Invalid settlement record')
 const r=value as SettlementRecord
 if(r.version!==1||r.provider!==ARC_TESTNET||!Number.isSafeInteger(r.revision)||r.revision<1||!Array.isArray(r.attempts)||r.attempts.length>3)throw new Error('Invalid settlement record')
 const evidence=readReopeningEvidence(r.evidence),summary=transactionSummary(evidence)
 if(r.txid!==summary.txid||r.rawHex!==summary.rawHex||r.efHex!==summary.efHex)throw new Error('Stored settlement transaction bytes do not match')
 const attempts:SubmissionAttempt[]=r.attempts.map(a=>{
  if(!a||!['pending','response','unknown'].includes(a.outcome)||a.error!==undefined&&(typeof a.error!=='string'||a.error.length>300))throw new Error('Invalid submission attempt')
  if(a.outcome==='response'&&!a.observation)throw new Error('Missing submission response')
  return {id:identifier(a.id),startedAt:date(a.startedAt),outcome:a.outcome,finishedAt:a.finishedAt===undefined?undefined:date(a.finishedAt),observation:a.observation?storedObservation(a.observation,r.txid):undefined,error:a.error}
 })
 if(new Set(attempts.map(a=>a.id)).size!==attempts.length)throw new Error('Duplicate attempt identifier')
 const history=r.statusChecks??[] // Earlier version-1 records had no GET history.
 if(!Array.isArray(history)||history.length>32)throw new Error('Invalid status check history')
 const statusChecks=history.map(c=>{if(!c)throw new Error('Invalid status check');return {checkedAt:date(c.checkedAt),observation:c.observation?storedObservation(c.observation,r.txid):undefined}})
 const lastStatus=r.lastStatus?storedObservation(r.lastStatus,r.txid):undefined
 let retryBlockedBy=r.retryBlockedBy
 if(retryBlockedBy!==undefined){parseObservation({txid:r.txid,txStatus:retryBlockedBy},r.txid);if(retryBlockedBy==='UNKNOWN')throw new Error('Invalid retry block')}
 retryBlockedBy??=[...attempts.map(a=>a.observation),...statusChecks.map(c=>c.observation),lastStatus].find(o=>o&&o.txStatus!=='UNKNOWN')?.txStatus
 const candidate=r.candidate?readReopeningEvidence(r.candidate):undefined
 if(candidate&&JSON.stringify({...candidate,pkg:{...candidate.pkg,atomicBeefBase64:evidence.pkg.atomicBeefBase64}})!==JSON.stringify(evidence))throw new Error('Candidate changed retained ticket evidence')
 if(r.reconciledAttemptId!==undefined&&r.reconciledAttemptId!==attempts.at(-1)?.id)throw new Error('Invalid reconciliation reference')
 return {version:1,txid:r.txid,revision:r.revision,provider:ARC_TESTNET,evidence,rawHex:r.rawHex,efHex:r.efHex,attempts,statusChecks,retryBlockedBy,lastStatus,candidate,reconciledAttemptId:r.reconciledAttemptId,lastStatusCheckedAt:r.lastStatusCheckedAt===undefined?undefined:date(r.lastStatusCheckedAt)}
}
export function ensureAttemptIdle(record:SettlementRecord):void{
 const last=record.attempts.at(-1)
 if(last?.outcome==='pending'&&Date.now()-Date.parse(last.startedAt)<60000)throw new Error('Submission may still be in progress. Wait at least 60 seconds before reconciling a pending attempt.')
}
export function nextClaim(current:SettlementRecord|undefined,review:TransferReview,expectedRevision:number|undefined,retryAcknowledged=false):SettlementRecord{
 const old=current===undefined?undefined:readSettlement(current),summary=transactionSummary(review.evidence)
 if(summary.rawHex!==review.rawHex||summary.efHex!==review.efHex||summary.txid!==review.txid)throw new Error('Reviewed bytes changed')
 if(old?.revision!==expectedRevision)throw new Error('Settlement changed in another tab; review again')
 if(old){
  ensureAttemptIdle(old)
  if(old.rawHex!==review.rawHex||old.efHex!==review.efHex||JSON.stringify(old.evidence)!==JSON.stringify(review.evidence))throw new Error('Saved evidence changed; no replacement transaction may be submitted')
  if(old.attempts.length>=3)throw new Error('Submission attempt limit reached; manual review required')
  if(old.retryBlockedBy)throw new Error(`Earlier provider status ${old.retryBlockedBy} blocks retry; manual review required`)
  if(old.attempts.length){
   if(!old.lastStatusCheckedAt||old.reconciledAttemptId!==old.attempts.at(-1)!.id)throw new Error('Check transfer status before any retry')
   if(!retryAcknowledged)throw new Error('Explicitly acknowledge an identical-byte retry despite an uncertain earlier outcome')
  }
 }
 const attempt:SubmissionAttempt={id:crypto.randomUUID(),startedAt:new Date().toISOString(),outcome:'pending'}
 return readSettlement({version:1,txid:review.txid,revision:(old?.revision??0)+1,provider:ARC_TESTNET,evidence:review.evidence,rawHex:review.rawHex,efHex:review.efHex,attempts:[...(old?.attempts??[]),attempt],statusChecks:old?.statusChecks??[]})
}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('transfers')
 r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)}
 r.onerror=r.onblocked=()=>reject(new Error('Settlement storage unavailable'))
})}
export async function loadSettlement(txid:string):Promise<SettlementRecord|undefined>{
 const db=await open()
 return new Promise((resolve,reject)=>{const tx=db.transaction('transfers'),r=tx.objectStore('transfers').get(txid);tx.oncomplete=()=>{db.close();try{resolve(r.result===undefined?undefined:readSettlement(r.result))}catch(e){reject(e)}};tx.onabort=tx.onerror=()=>{db.close();reject(new Error('Settlement read failed'))}})
}
async function update(txid:string,change:(current:SettlementRecord|undefined)=>SettlementRecord):Promise<SettlementRecord>{
 const db=await open()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('transfers','readwrite'),store=tx.objectStore('transfers'),r=store.get(txid);let next:SettlementRecord,error:unknown
  r.onsuccess=()=>{try{next=change(r.result===undefined?undefined:readSettlement(r.result));store.put(next,txid)}catch(e){error=e;tx.abort()}}
  tx.oncomplete=()=>{db.close();resolve(next)}
  tx.onerror=tx.onabort=()=>{db.close();reject(error??new Error('Settlement save failed; any sent transaction has an unknown outcome'))}
 })
}
export async function claimSubmission(review:TransferReview,revision:number|undefined,retry=false):Promise<SettlementRecord>{return update(review.txid,current=>nextClaim(current,review,revision,retry))}
// A status lookup can precede the first POST. Keep its observations even then.
export async function ensureSettlement(value:ReopeningEvidence):Promise<SettlementRecord>{
 const summary=transactionSummary(value)
 return update(summary.txid,current=>{
  if(current){if(JSON.stringify(current.evidence)!==JSON.stringify(summary.evidence))throw new Error('Saved settlement evidence differs; manual review required');return current}
  return readSettlement({version:1,txid:summary.txid,revision:1,provider:ARC_TESTNET,evidence:summary.evidence,rawHex:summary.rawHex,efHex:summary.efHex,attempts:[],statusChecks:[]})
 })
}
export async function saveSettlement(next:SettlementRecord,expectedRevision:number):Promise<void>{
 const clean=readSettlement(next)
 await update(clean.txid,current=>{
  if(current?.revision!==expectedRevision||clean.revision!==expectedRevision+1)throw new Error('Settlement changed in another tab; refresh to review')
  if(current.rawHex!==clean.rawHex||current.efHex!==clean.efHex||JSON.stringify(current.evidence)!==JSON.stringify(clean.evidence)||current.attempts.length!==clean.attempts.length||current.attempts.some((a,i)=>a.id!==clean.attempts[i].id))throw new Error('Settlement attempt history changed')
  if(current.retryBlockedBy&&clean.retryBlockedBy!==current.retryBlockedBy)throw new Error('Earlier provider status cannot be cleared')
  if(JSON.stringify(current.statusChecks)!==JSON.stringify(clean.statusChecks)){
   const appended=[...current.statusChecks.slice(-31),{checkedAt:clean.lastStatusCheckedAt,observation:clean.lastStatus}]
   if(!clean.lastStatusCheckedAt||JSON.stringify(clean.statusChecks)!==JSON.stringify(appended))throw new Error('Status check history changed')
  }
  for(let i=0;i<current.attempts.length;i++){
   const before=current.attempts[i],after=clean.attempts[i]
   if(JSON.stringify(before)===JSON.stringify(after))continue
   // Only the current pending attempt can receive its first final response.
   // Reconciliation adds a separate status; it never rewrites this history.
   if(i!==current.attempts.length-1||before.outcome!=='pending'||after.outcome==='pending'||before.startedAt!==after.startedAt||!after.finishedAt)throw new Error('Settlement attempt history changed')
  }
  return clean
 })
}
