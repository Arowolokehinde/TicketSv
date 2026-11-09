import {identifier,publicKey,readReceiveRequest,readTicketPackage,fromBase64} from '../tickets/codec.ts'
import {readReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import {parseObservation} from '../settlement/arc.ts'
import type {ArcObservation} from '../settlement/types.ts'
import type {ReceiveRequest,TicketPackage,KeyBinding} from '../tickets/types.ts'
import type {ConflictBranch} from './types.ts'
export type ConflictPhase='issue'|'attest'|'sign-a'|'sign-b'|'submit-a'|'submit-b'
export type ConflictAttempt={id:string;phase:ConflictPhase;outcome:'pending'|'complete'|'unknown';startedAt:string;finishedAt?:string;reference?:string;returned?:{txid?:string;atomicBeefBase64?:string}}
export type ConflictRecord={version:1;id:string;revision:number;trusted:string;eventId:string;ticketId:string;keys?:{source:ReceiveRequest;a:ReceiveRequest;b:ReceiveRequest;fees:Record<ConflictBranch,KeyBinding>};issued?:{txid:string;atomicBeefBase64:string};issuance?:TicketPackage;branches:Partial<Record<ConflictBranch,ReopeningEvidence>>;attempts:ConflictAttempt[];observations:Partial<Record<ConflictBranch,{checkedAt:string;value?:ArcObservation}[]>>}
export type ConflictPersistence={load:()=>Promise<ConflictRecord>;save:(next:ConflictRecord,expectedRevision:number)=>Promise<void>}
const phases=['issue','attest','sign-a','sign-b','submit-a','submit-b']
const timestamp=(s:unknown):string=>{if(typeof s!=='string'||s.length>40||!Number.isFinite(Date.parse(s)))throw new Error('Invalid conflict date');return s}
export function readConflictRun(value:unknown):ConflictRecord{
 if(!value||typeof value!=='object'||JSON.stringify(value).length>16*1024*1024)throw new Error('Invalid conflict record')
 const r=structuredClone(value) as ConflictRecord
 if(r.version!==1||typeof r.id!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(r.id)||!Number.isSafeInteger(r.revision)||r.revision<0||!Array.isArray(r.attempts)||r.attempts.length>6||!r.branches||!r.observations)throw new Error('Invalid conflict record')
 r.trusted=publicKey(r.trusted);identifier(r.eventId);identifier(r.ticketId)
 const seen=new Set<string>()
 for(const a of r.attempts){if(!a||!phases.includes(a.phase)||seen.has(a.phase)||typeof a.id!=='string'||!a.id||!['pending','complete','unknown'].includes(a.outcome))throw new Error('Invalid conflict attempt');seen.add(a.phase);timestamp(a.startedAt);if(a.outcome==='pending'?a.finishedAt!==undefined:a.finishedAt===undefined)throw new Error('Invalid conflict outcome');if(a.finishedAt)timestamp(a.finishedAt);if(a.reference!==undefined&&(typeof a.reference!=='string'||a.reference.length>256))throw new Error('Invalid reference');if(a.returned){if(a.returned.txid!==undefined&&!/^[0-9a-f]{64}$/.test(a.returned.txid))throw new Error('Invalid returned transaction ID');if(a.returned.atomicBeefBase64!==undefined)fromBase64(a.returned.atomicBeefBase64)}}
 if(r.keys){for(const name of ['source','a','b'] as const)r.keys[name]=readReceiveRequest(JSON.stringify(r.keys[name]));for(const name of ['a','b'] as const){const key=r.keys.fees[name];publicKey(key.publicKey);if(JSON.stringify(key.protocolID)!==JSON.stringify([2,'counterfoil conflict fees'])||key.keyID!==`${r.id}-fee-${name}`||key.counterparty!=='self')throw new Error('Invalid conflict fee key')}
  const requests=[r.keys.source,r.keys.a,r.keys.b];if(new Set(requests.map(x=>x.recipient.publicKey)).size!==3||requests.some((x,i)=>x.requestId!==`${r.id}-${['source','a','b'][i]}`))throw new Error('Invalid conflict receiving keys')
 }
 if(r.issued){if(!/^[0-9a-f]{64}$/.test(r.issued.txid))throw new Error('Invalid issued txid');fromBase64(r.issued.atomicBeefBase64)}
 if(r.issuance){r.issuance=readTicketPackage(JSON.stringify(r.issuance));if(r.issuance.issuance.issuerIdentity!==r.trusted||r.issuance.issuance.eventId!==r.eventId||r.issuance.issuance.ticketId!==r.ticketId||r.issuance.current.txid!==r.issued?.txid||r.issuance.current.index!==0||r.issuance.lineageRawTxs.length!==1)throw new Error('Conflict issuance changed')}
 for(const branch of ['a','b'] as const){const e=r.branches[branch];if(e){r.branches[branch]=readReopeningEvidence(e);if(e.trusted!==r.trusted||JSON.stringify(e.buyer)!==JSON.stringify(r.keys?.[branch])||JSON.stringify(e.pkg.issuance)!==JSON.stringify(r.issuance?.issuance))throw new Error('Conflict branch changed')}
  const os=r.observations[branch];if(os){if(!e||!Array.isArray(os)||os.length>32)throw new Error('Invalid conflict observations');for(const o of os){timestamp(o.checkedAt);if(o.value){const parsed=parseObservation(o.value,e.pkg.current.txid);o.value={...parsed,observedAt:timestamp(o.value.observedAt)}}}}
 }
 return r
}
export function newConflictRun(config:{trusted:string;eventId:string;ticketId:string}):ConflictRecord{return readConflictRun({version:1,id:crypto.randomUUID(),revision:0,...config,branches:{},attempts:[],observations:{}})}
export function claimConflictStep(value:ConflictRecord,phase:ConflictPhase):ConflictRecord{
 const r=readConflictRun(value)
 if(r.attempts.some(a=>a.outcome!=='complete'||a.phase===phase))throw new Error('An attempt exists or is uncertain. Do not retry; review the diagnostic.')
 return readConflictRun({...r,revision:r.revision+1,attempts:[...r.attempts,{id:crypto.randomUUID(),phase,outcome:'pending',startedAt:new Date().toISOString()}]})
}
export function finishConflictStep(value:ConflictRecord,phase:ConflictPhase,outcome:'complete'|'unknown',patch:Partial<Pick<ConflictRecord,'issued'|'issuance'|'branches'>>={}):ConflictRecord{
 const r=readConflictRun(value),a=r.attempts.at(-1);if(a?.phase!==phase||a.outcome!=='pending')throw new Error('Attempt is already final')
 return readConflictRun({...r,...patch,revision:r.revision+1,attempts:r.attempts.map(x=>x.id===a.id?{...x,outcome,finishedAt:new Date().toISOString()}:x)})
}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('counterfoil-conflict-experiment-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('runs');r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)};r.onerror=r.onblocked=()=>reject(new Error('Conflict storage unavailable'))})}
export async function loadConflictRun(id:string):Promise<ConflictRecord|undefined>{const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('runs'),q=t.objectStore('runs').get(id);t.oncomplete=()=>{db.close();try{resolve(q.result===undefined?undefined:readConflictRun(q.result))}catch(e){reject(e)}};t.onerror=t.onabort=()=>{db.close();reject(new Error('Conflict storage read failed'))}})}
export async function listConflictRuns():Promise<ConflictRecord[]>{const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('runs'),q=t.objectStore('runs').getAll();t.oncomplete=()=>{db.close();try{resolve(q.result.map(readConflictRun))}catch(e){reject(e)}};t.onerror=t.onabort=()=>{db.close();reject(new Error('Conflict storage read failed'))}})}
export async function updateConflictRun(value:ConflictRecord,expectedRevision:number|undefined):Promise<void>{
 const next=readConflictRun(value),db=await open();return new Promise((resolve,reject)=>{const t=db.transaction('runs','readwrite'),store=t.objectStore('runs'),q=store.get(next.id);let error:unknown
 q.onsuccess=()=>{try{
  const old=q.result===undefined?undefined:readConflictRun(q.result)
  if(old?.revision!==expectedRevision||next.revision!==(old?old.revision+1:0))throw new Error('Conflict run changed in another tab; reload before continuing')
  if(old){for(const key of ['trusted','eventId','ticketId','keys','issued'] as const)if(old[key]!==undefined&&JSON.stringify(old[key])!==JSON.stringify(next[key]))throw new Error('Existing conflict evidence is immutable')
   if(old.issuance&&JSON.stringify({...old.issuance,atomicBeefBase64:''})!==JSON.stringify({...next.issuance,atomicBeefBase64:''}))throw new Error('Issuance changed')
   for(const b of ['a','b'] as const)if(old.branches[b]&&JSON.stringify(old.branches[b])!==JSON.stringify(next.branches[b]))throw new Error('Signed branch changed')
   for(let i=0;i<old.attempts.length;i++){const a=old.attempts[i],n=next.attempts[i];if(!n||a.id!==n.id||a.phase!==n.phase||a.startedAt!==n.startedAt||a.outcome!=='pending'&&JSON.stringify(a)!==JSON.stringify(n))throw new Error('Attempt history changed')}
  }
  store.put(next,next.id)
 }catch(e){error=e;t.abort()}}
 t.oncomplete=()=>{db.close();resolve()};t.onerror=t.onabort=()=>{db.close();reject(error??new Error('Conflict journal save failed; do not repeat any wallet action'))}
 })
}
export async function createConflictRun(config:Parameters<typeof newConflictRun>[0]){const r=newConflictRun(config);await updateConflictRun(r,undefined);return r}
export function conflictPersistence(id:string):ConflictPersistence{return {load:async()=>{const r=await loadConflictRun(id);if(!r)throw new Error('Conflict run missing');return r},save:updateConflictRun}}
