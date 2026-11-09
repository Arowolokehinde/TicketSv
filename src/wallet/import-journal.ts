import {readReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import type {ImportReview} from './import-review.ts'
export type ImportObservation=Pick<ImportReview,'state'|'reason'|'outpoint'|'snapshotId'|'checkedAt'>
export type ImportRecord={version:1;evidence:ReopeningEvidence;attempt:{id:string;startedAt:string;outcome:'pending'|'accepted'|'unknown';finishedAt?:string};observations:ImportObservation[]}
const DB='counterfoil-wallet-import-v1'
function date(value:unknown){if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))throw new Error('Invalid import observation date');return value}
export function readImportRecord(value:unknown):ImportRecord{
 if(!value||typeof value!=='object')throw new Error('Invalid wallet import record')
 const r=value as ImportRecord,evidence=readReopeningEvidence(r.evidence),a=r.attempt
 if(r.version!==1||!a||typeof a.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(a.id)||!['pending','accepted','unknown'].includes(a.outcome)||!Array.isArray(r.observations)||r.observations.length>16)throw new Error('Invalid wallet import record')
 if(a.outcome==='pending'?a.finishedAt!==undefined:a.finishedAt===undefined)throw new Error('Invalid import completion state')
 const observations=r.observations.map(o=>{
  if(!o||!['present','absent','inconclusive'].includes(o.state)||o.outpoint!==`${evidence.pkg.current.txid}.${evidence.pkg.current.index}`||typeof o.reason!=='string'||o.reason.length>1000||typeof o.snapshotId!=='string'||!/^[0-9a-f]{64}$/.test(o.snapshotId))throw new Error('Invalid wallet import observation')
  return {state:o.state,reason:o.reason,outpoint:o.outpoint,snapshotId:o.snapshotId,checkedAt:date(o.checkedAt)}
 })
 return {version:1,evidence,attempt:{id:a.id,startedAt:date(a.startedAt),outcome:a.outcome,...(a.finishedAt?{finishedAt:date(a.finishedAt)}:{})},observations}
}
export function newImportRecord(evidence:ReopeningEvidence):ImportRecord{return readImportRecord({version:1,evidence,attempt:{id:crypto.randomUUID(),startedAt:new Date().toISOString(),outcome:'pending'},observations:[]})}
export function finishRecord(value:ImportRecord,id:string,outcome:'accepted'|'unknown'):ImportRecord{
 const r=readImportRecord(value)
 if(r.attempt.id!==id||r.attempt.outcome!=='pending')throw new Error('Import response is already final or belongs to another attempt')
 return readImportRecord({...r,attempt:{...r.attempt,outcome,finishedAt:new Date().toISOString()}})
}
export function observationRecord(value:ImportRecord,id:string,review:ImportReview):ImportRecord{
 const r=readImportRecord(value)
 if(r.attempt.id!==id||review.walletIdentity!==r.evidence.trusted||review.requestId!==r.evidence.buyer.requestId)throw new Error('Import observation identity differs')
 const {state,reason,outpoint,snapshotId,checkedAt}=review
 return readImportRecord({...r,observations:[...r.observations.slice(-15),{state,reason,outpoint,snapshotId,checkedAt}]})
}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('imports')
 r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)}
 r.onerror=r.onblocked=()=>reject(new Error('Wallet import storage unavailable'))
})}
export async function loadImport(txid:string):Promise<ImportRecord|undefined>{
 const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('imports'),r=t.objectStore('imports').get(txid);t.oncomplete=()=>{db.close();try{resolve(r.result===undefined?undefined:readImportRecord(r.result))}catch(e){reject(e)}};t.onerror=t.onabort=()=>{db.close();reject(new Error('Wallet import record could not be read'))}})
}
async function update(txid:string,change:(old:unknown)=>ImportRecord):Promise<ImportRecord>{
 const db=await open();return new Promise((resolve,reject)=>{
  const t=db.transaction('imports','readwrite'),store=t.objectStore('imports'),r=store.get(txid);let next:ImportRecord,error:unknown
  r.onsuccess=()=>{try{next=change(r.result);if(next.evidence.pkg.current.txid!==txid)throw new Error('Import transaction changed');store.put(next,txid)}catch(e){error=e;t.abort()}}
  t.oncomplete=()=>{db.close();resolve(next)};t.onabort=t.onerror=()=>{db.close();reject(error??new Error('Import state could not be saved; any wallet outcome remains uncertain. Do not retry.'))}
 })
}
export function claimImport(evidence:ReopeningEvidence){return update(evidence.pkg.current.txid,old=>{if(old!==undefined)throw new Error('A wallet import was already attempted. Reconcile without retrying.');return newImportRecord(evidence)})}
export function finishImport(txid:string,id:string,outcome:'accepted'|'unknown'){return update(txid,old=>finishRecord(readImportRecord(old),id,outcome))}
export function observeImport(txid:string,id:string,review:ImportReview){return update(txid,old=>observationRecord(readImportRecord(old),id,review))}
