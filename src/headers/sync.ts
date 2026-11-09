import { CHECKPOINT, validHeaderHeight } from './checkpoint.ts'
import { appendSnapshot, parseProviderHeader, validateSnapshot, validateHeader } from './validate.ts'
import type { Provider, HeaderRecord, HeaderSnapshot } from './validate.ts'
export type HeaderContact = { provider: Provider; height: number; at: string; status: 'ok'|'failed';attempt?:number;failure?:'network'|'timeout'|'http'|'invalid'|'cancelled';httpStatus?:number }
export type HeaderFetcher = (provider: Provider,height: number,signal: AbortSignal)=>Promise<HeaderRecord>
export type HeaderSyncProgress = {completed:number;total:number;height:number;reused?:number;phase?:'collecting'|'retrying'|'downloading'|'checking'}
export type HeaderSyncOptions = {fullRefresh?:boolean;onCheckpoint?:(snapshot:HeaderSnapshot)=>Promise<void>}
const origins = {whatsonchain:'https://api.whatsonchain.com/v1/bsv/test/block/',chaintracks:'https://arcade-v2-testnet-us-1.bsvblockchain.tech/chaintracks/v2/header/height/'} as const
class HeaderFetchError extends Error {
 readonly retryable:boolean
 readonly retryAfterMs?:number
 constructor(message:string,retryable:boolean,retryAfterMs?:number){super(message);this.retryable=retryable;this.retryAfterMs=retryAfterMs}
}
function retryAfter(value:string|null):number|undefined {
 if(value===null)return
 const ms=/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now()
 return Number.isFinite(ms)?Math.max(0,ms):undefined
}
export async function fetchProviderHeader(provider: Provider,height: number,signal: AbortSignal,log: (entry:HeaderContact)=>void,attempt=1): Promise<HeaderRecord> {
 const combined=AbortSignal.any([signal,AbortSignal.timeout(20_000)])
 let status:HeaderContact['status']='failed'
 let failure:HeaderContact['failure'],httpStatus:number|undefined,validating=false
 try {
  combined.throwIfAborted()
  const response=await fetch(origins[provider]+height+(provider==='whatsonchain'?'/header':''),{signal:combined,credentials:'omit',redirect:'error',cache:'no-store'})
  if(!response.ok){
   httpStatus=response.status;failure='http';void response.body?.cancel().catch(()=>{})
   throw new HeaderFetchError(`HTTP ${response.status}`,response.status===408||response.status===429||response.status>=500&&response.status<=599,retryAfter(response.headers.get('retry-after')))
  }
  if(!response.body || Number(response.headers.get('content-length'))>16384) throw new Error('Header response exceeds size limit')
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let size=0
  // Explicitly interrupt body reads as well as fetch; no late response can be promoted.
  const interrupt=()=>{void reader.cancel(combined.reason).catch(()=>{})}
  combined.addEventListener('abort',interrupt,{once:true})
  if(combined.aborted)interrupt()
  try { while(true) {
   const {done,value}=await reader.read();combined.throwIfAborted();if(done)break
   size+=value.byteLength;if(size>16384)throw new Error('Header response exceeds size limit');chunks.push(value)
  } } finally {combined.removeEventListener('abort',interrupt);void reader.cancel().catch(()=>{});reader.releaseLock()}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  validating=true
  const record=parseProviderHeader(JSON.parse(new TextDecoder().decode(bytes)),provider,height)
  status='ok';return record
 } catch(e){
  if(signal.aborted){failure='cancelled';throw signal.reason}
  let problem:HeaderFetchError
  if(combined.aborted){failure='timeout';problem=new HeaderFetchError('request timed out',true)}
  else if(e instanceof HeaderFetchError)problem=e
  else if(e instanceof TypeError&&!validating){failure='network';problem=new HeaderFetchError('network request failed (connection or browser access error)',true)}
  else{failure='invalid';problem=new HeaderFetchError(e instanceof Error?e.message:'Invalid header response',false)}
  throw new HeaderFetchError(`${provider} at height ${height}: ${problem.message}`,problem.retryable,problem.retryAfterMs)
 } finally {log({provider,height,at:new Date().toISOString(),status,attempt,...(failure?{failure}:{}),...(httpStatus!==undefined?{httpStatus}:{})})}
}
export async function syncHeaders(height: number,previous:HeaderSnapshot|undefined,get:HeaderFetcher,signal:AbortSignal,onProgress?:(progress:HeaderSyncProgress)=>void,options:HeaderSyncOptions={}):Promise<{snapshot:HeaderSnapshot;affectedHeights:number[]}> {
 signal.throwIfAborted()
 signal=AbortSignal.any([signal,AbortSignal.timeout(120_000)])
 const old=previous?validateSnapshot(previous):undefined
 const target=Math.max(height,old?.headers.at(-1)?.height??CHECKPOINT.height)
 if(!validHeaderHeight(height)) throw new Error('Invalid header height/range.')
 const records:HeaderRecord[]=options.fullRefresh?[]:[...(old?.headers??[])]
 let accepted=options.fullRefresh?undefined:old
 let published=records.length
 const checkpoint=()=>{accepted=appendSnapshot(accepted,records.slice(published),undefined,options.fullRefresh?undefined:old?.source);published=records.length;return accepted}
 const reused=records.length
 async function agreed(h:number){
  signal.throwIfAborted()
  const [a,b]=await Promise.all([get('whatsonchain',h,signal),get('chaintracks',h,signal)])
  signal.throwIfAborted()
  if(a.height!==h || b.height!==h || a.hash!==b.hash || a.hex!==b.hex) throw new Error('Header sources disagree — previous snapshot retained')
  return a
 }
 // Reuse only a locally revalidated contiguous prefix whose boundary still
 // agrees with both sources. A changed boundary needs an explicit full recheck.
 if(reused){
  const tip=records[reused-1],remote=await agreed(tip.height)
  if(remote.hash!==tip.hash||remote.hex!==tip.hex)throw new Error('Saved header boundary changed — use Recheck all headers while online. Saved snapshot retained.')
  onProgress?.({completed:reused,total:target-CHECKPOINT.height+1,height:tip.height,reused})
 }
 for(let h=CHECKPOINT.height+reused;h<=target;h++){
  const a=await agreed(h),checked=validateHeader(a.hex)
  if(checked.hash!==a.hash)throw new Error('Header hash does not match its bytes')
  if(records.length?checked.previousHash!==records.at(-1)!.hash:a.hash!==CHECKPOINT.hash)throw new Error('Header linkage/checkpoint conflict — saved snapshot retained')
  records.push(Object.freeze({height:a.height,hash:a.hash,hex:a.hex}))
  // Full rechecks may replace history: publish those only when complete.
  // Incremental prefixes are fully validated snapshots, not unchecked downloads.
  const added=records.length-reused
  if(!options.fullRefresh&&options.onCheckpoint&&(added===1||added%32===0)){
   await options.onCheckpoint(checkpoint());signal.throwIfAborted()
  }
  onProgress?.({completed:records.length,total:target-CHECKPOINT.height+1,height:h,...(reused?{reused}:{})})
 }
 const snapshot=checkpoint()
 const affectedHeights=old?.headers.filter((h,i)=>h.hash!==snapshot.headers[i].hash).map(h=>h.height)??[]
 return {snapshot,affectedHeights}
}
// Anonymous WhatsOnChain requests are paced; each operation gets its own queue.
function pause(ms:number,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted()
 return new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(signal.reason)}
  const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve()},ms)
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop()
 })
}
export function pacedHeaderFetcher(log:(entry:HeaderContact)=>void):HeaderFetcher {
 let last=0
 return async(provider,height,signal)=>{
  for(let attempt=1;attempt<=3;attempt++){
   signal.throwIfAborted()
   if(provider==='whatsonchain'){
    const delay=Math.max(0,400-(Date.now()-last))
    if(delay)await pause(delay,signal)
    last=Date.now()
   }
   try{return await fetchProviderHeader(provider,height,signal,log,attempt)}
   catch(e){
    signal.throwIfAborted()
    if(!(e instanceof HeaderFetchError)||!e.retryable)throw e
    if(attempt===3)throw new Error(`${e.message}; stopped after 3 attempts. Previous snapshot retained.`)
    if((e.retryAfterMs??0)>60000)throw new Error(`${e.message}; source requested a longer wait. Try syncing later. Previous snapshot retained.`)
    await pause(Math.max(1000*2**attempt,e.retryAfterMs??0),signal)
   }
  }
  throw new Error('Header retry limit reached')
 }
}
