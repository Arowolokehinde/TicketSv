import {publicKey,identifier,readReceiveRequest,readTicketPackage} from './codec.ts'
import type {ReceiveRequest,TicketPackage} from './types.ts'
import {summarizeError,type ErrorSummary,type WalletFailureResponse} from '../wallet/diagnostics.ts'

export const EXPERIMENT_DB='counterfoil-durable-ticket-v1'
export type DiagnosticFailure=ErrorSummary&{method?:string;walletResponse?:WalletFailureResponse}
export type ExperimentRecord={
 version:1;id:string;revision:number;trusted:string;eventId:string;ticketId:string;
 attempt:{id:string;phase:'issue'|'transfer';status:'pending'|'complete'|'failed';at:string};
 references:string[];pkg?:TicketPackage;buyer?:ReceiveRequest;failure?:DiagnosticFailure;
 recoveredPreflight?:{attempt:ExperimentRecord['attempt'];failure:DiagnosticFailure;at:string}
}
export function readExperiment(value:unknown):ExperimentRecord{
 if(!value||typeof value!=='object'||JSON.stringify(value).length>5*1024*1024)throw new Error('Invalid stored diagnostic')
 const r=value as ExperimentRecord,a=r.attempt
 if(r.version!==1||!Number.isSafeInteger(r.revision)||r.revision<1||!a||!['issue','transfer'].includes(a.phase)||!['pending','complete','failed'].includes(a.status)||!Number.isFinite(Date.parse(a.at))||!Array.isArray(r.references)||r.references.length>32||!r.references.every(x=>typeof x==='string'&&x.length>0&&x.length<=256))throw new Error('Invalid stored diagnostic')
 const pkg=r.pkg===undefined?undefined:readTicketPackage(JSON.stringify(r.pkg)),buyer=r.buyer===undefined?undefined:readReceiveRequest(JSON.stringify(r.buyer))
 const trusted=publicKey(r.trusted),eventId=identifier(r.eventId),ticketId=identifier(r.ticketId)
 if(pkg&&(pkg.issuance.issuerIdentity!==trusted||pkg.issuance.eventId!==eventId||pkg.issuance.ticketId!==ticketId))throw new Error('Stored diagnostic identity mismatch')
 if(a.status==='complete'&&(!pkg||!buyer||pkg.lineageRawTxs.length!==(a.phase==='issue'?1:2)))throw new Error('Stored diagnostic is incomplete')
 let recoveredPreflight:ExperimentRecord['recoveredPreflight']
 if(r.recoveredPreflight){
  const recovery=r.recoveredPreflight
  if(!recovery.attempt||recovery.attempt.phase!=='transfer'||recovery.attempt.status!=='failed'||
   !Number.isFinite(Date.parse(recovery.attempt.at))||!Number.isFinite(Date.parse(recovery.at))||
   recovery.failure?.message!=='Expected a newly created, unmined transaction.'||recovery.failure.method!=='getPublicKey'||recovery.failure.walletResponse)throw new Error('Invalid preflight recovery record')
  recoveredPreflight={attempt:{id:identifier(recovery.attempt.id),phase:'transfer',status:'failed',at:recovery.attempt.at},failure:{...summarizeError(recovery.failure),method:'getPublicKey'},at:recovery.at}
 }
 const response=r.failure?.walletResponse
 return {version:1,id:identifier(r.id),revision:r.revision,trusted,eventId,ticketId,
  attempt:{id:identifier(a.id),phase:a.phase,status:a.status,at:a.at},references:[...r.references],pkg,buyer,recoveredPreflight,
  failure:r.failure?{...summarizeError(r.failure),method:r.failure.method?.slice(0,80),walletResponse:response?{...summarizeError(response),method:response.method.slice(0,80),status:response.status}:undefined}:undefined}
}
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
 const req=indexedDB.open(EXPERIMENT_DB,1)
 req.onupgradeneeded=()=>req.result.createObjectStore('records')
 req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result)}
 req.onerror=req.onblocked=()=>reject(new Error('Diagnostic storage could not be opened'))
})}
export async function loadExperiment():Promise<ExperimentRecord|undefined>{
 const db=await open()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('records','readonly'),req=tx.objectStore('records').get('current')
  tx.oncomplete=()=>{db.close();try{resolve(req.result===undefined?undefined:readExperiment(req.result))}catch(e){reject(e)}}
  tx.onerror=tx.onabort=()=>{db.close();reject(new Error('Diagnostic storage read failed'))}
 })
}
// Compare-and-swap in one readwrite transaction: no async gap between read and put.
// A second tab, stale proof refresh or late response cannot overwrite a newer claim.
export async function saveExperiment(expected:ExperimentRecord|undefined,next:ExperimentRecord):Promise<ExperimentRecord>{
 const clean=readExperiment(next)
 if(clean.revision!==(expected?.revision??0)+1)throw new Error('Invalid diagnostic revision')
 const db=await open()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),req=store.get('current')
  let conflict=false
  req.onsuccess=()=>{
   const current=req.result as ExperimentRecord|undefined
   if((current===undefined)!==(expected===undefined)||current&&(current.id!==expected?.id||current.revision!==expected.revision)){conflict=true;tx.abort();return}
   store.put(clean,'current')
  }
  tx.oncomplete=()=>{db.close();resolve(clean)}
  tx.onerror=tx.onabort=()=>{db.close();reject(new Error(conflict?'Diagnostic changed in another tab. Reload to review; no repeat action was sent.':'Diagnostic storage write failed; wallet outcome requires review.'))}
 })
}
export async function claimExperiment(expected:ExperimentRecord|undefined,initial:{trusted:string;eventId:string;ticketId:string}):Promise<ExperimentRecord>{
 if(expected&&(expected.attempt.status!=='complete'||expected.attempt.phase!=='issue'||!expected.pkg||!expected.buyer))throw new Error('Wallet outcome requires review; mutations are blocked')
 const attempt={id:crypto.randomUUID(),phase:expected?'transfer' as const:'issue' as const,status:'pending' as const,at:new Date().toISOString()}
 return saveExperiment(expected,expected?{...expected,revision:expected.revision+1,attempt,failure:undefined}:{...initial,version:1,id:crypto.randomUUID(),revision:1,attempt,references:[]})
}

// This is a migration for one audited harness error, not a general failure reset.
// In the old transfer path this exact local error + last method getPublicKey +
// only the issuance reference locates rejection before the first createAction.
export function canReviewMinedSourceFailure(r:ExperimentRecord):boolean{
 return r.attempt.phase==='transfer'&&r.attempt.status==='failed'&&!r.recoveredPreflight&&
  r.failure?.message==='Expected a newly created, unmined transaction.'&&r.failure.method==='getPublicKey'&&!r.failure.walletResponse&&
  !!r.pkg&&!!r.buyer&&r.pkg.lineageRawTxs.length===1&&r.pkg.current.txid===r.pkg.issuance.origin.txid&&r.pkg.current.index===r.pkg.issuance.origin.index&&
  r.references.length===1&&r.references[0]===r.pkg.issuance.origin.txid
}
