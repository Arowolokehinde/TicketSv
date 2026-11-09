import { api, type AuthSession } from '../auth/api.ts'
import { CHECKPOINT, validHeaderHeight } from './checkpoint.ts'
import { boundedBytes, decodeHeaderBatch, HEADER_BATCH_SIZE } from './batch.ts'
import { appendSnapshot, validateSnapshot, type HeaderSnapshot } from './validate.ts'
import type { HeaderSyncProgress } from './sync.ts'

// Enable after shared source consistency and collector scheduling are confirmed.
export const SHARED_HEADERS_ENABLED = (import.meta as ImportMeta & { env?: Record<string,string> }).env?.VITE_SHARED_HEADERS === 'true'

type CacheStatus = { network: string; checkpoint: { height: number; hash: string }; tip: number | null; target: number; state: string }
export function checkedStatus(value: unknown): CacheStatus {
 const s=value as CacheStatus
 if(!s || s.network!=='testnet' || s.checkpoint?.height!==CHECKPOINT.height || s.checkpoint.hash!==CHECKPOINT.hash ||
  s.tip!==null && !validHeaderHeight(s.tip) ||
  !validHeaderHeight(s.target) ||
  !['queued','collecting','ready','retrying','blocked'].includes(s.state)) throw Error('Invalid shared header cache response')
 if(s.state==='blocked') throw Error('Shared header sources need review. Saved headers have been retained.')
 return s
}
function pause(signal:AbortSignal):Promise<void>{
 signal.throwIfAborted()
 return new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',stop);reject(signal.reason)}
  const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve()},3000)
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop()
 })
}
export async function syncCachedHeaders(height:number, previous:HeaderSnapshot|undefined, signal:AbortSignal,
 onProgress?:(progress:HeaderSyncProgress)=>void, persist?:(snapshot:HeaderSnapshot)=>Promise<void>, options?:{useCookieSession?:boolean}):Promise<HeaderSnapshot>{
 signal.throwIfAborted()
 if(!validHeaderHeight(height)) throw Error('Invalid required header height.')
 let snapshot=previous?validateSnapshot(previous):undefined
 if(snapshot && snapshot.headers.at(-1)!.height>=height)return snapshot
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(120_000)])
 // Standalone handoff pages do not mount AuthProvider. Resolve the cookie
 // session for this request only; never change their global auth state.
 const session=options?.useCookieSession?await api<AuthSession>('/api/auth/session',{signal:bounded}):undefined
 const identityHeaders=session?{'x-ticketsv-identity':session.identityKey}:undefined
 const prepare=async()=>checkedStatus(await api('/api/tickets/header-preparation',{method:'POST',headers:identityHeaders,body:JSON.stringify({height}),signal:AbortSignal.any([bounded,AbortSignal.timeout(15_000)])},16384))
 try {
 let status=await prepare()
 const total=height-CHECKPOINT.height+1,reused=snapshot?.headers.length??0
 while((snapshot?.headers.at(-1)?.height??CHECKPOINT.height-1)<height){
  bounded.throwIfAborted()
  const start=snapshot?.headers.at(-1)?.height??CHECKPOINT.height
  if(status.tip===null || status.tip<start || snapshot && status.tip===start){
   if(status.tip!==null && status.tip>=status.target && status.target<height){status=await prepare();continue}
   onProgress?.({completed:snapshot?.headers.length??0,total,height:start,reused,phase:status.state==='retrying'?'retrying':'collecting'})
   await pause(bounded)
   const requestSignal=AbortSignal.any([bounded,AbortSignal.timeout(15_000)])
   const response=await fetch('/api/headers/status',{signal:requestSignal,credentials:'same-origin',redirect:'error',cache:'no-store'})
   status=checkedStatus(JSON.parse(new TextDecoder().decode(await boundedBytes(response,16384,requestSignal))))
   continue
  }
  const count=Math.min(HEADER_BATCH_SIZE,height-start+1,status.tip-start+1)
  onProgress?.({completed:snapshot?.headers.length??0,total,height:start,reused,phase:'downloading'})
  bounded.throwIfAborted()
  const requestSignal=AbortSignal.any([bounded,AbortSignal.timeout(15_000)])
  const response=await fetch(`/api/headers/range?start=${start}&count=${count}`,{signal:requestSignal,credentials:'same-origin',redirect:'error',cache:'no-store'})
  const meta=response.headers
  if(meta.get('X-TicketSV-Header-Start')!==String(start)||meta.get('X-TicketSV-Header-Count')!==String(count)||meta.get('X-TicketSV-Header-Network')!=='testnet'||meta.get('X-TicketSV-Header-Checkpoint')!==CHECKPOINT.hash||meta.get('X-TicketSV-Header-Comparison')!=='server-reported'){
   void response.body?.cancel().catch(()=>{});throw Error('Shared header range unavailable or invalid. Saved progress retained.')
  }
  const records=decodeHeaderBatch(await boundedBytes(response,count*80,requestSignal),start,count)
  const boundary=snapshot?.headers.at(-1)
  if(boundary && (records[0].hash!==boundary.hash||records[0].hex!==boundary.hex))throw Error('Saved header boundary changed; explicit review required.')
  const next=appendSnapshot(snapshot,records.slice(boundary?1:0),undefined,'ticketsv-cache')
  bounded.throwIfAborted()
  await persist?.(next)
  bounded.throwIfAborted()
  snapshot=next
  onProgress?.({completed:next.headers.length,total,height:next.headers.at(-1)!.height,reused,phase:'checking'})
 }
 return snapshot!
 } catch(error) {
  if(!signal.aborted&&bounded.aborted)throw Error('Verification data is still being prepared. Saved header progress is retained. Try Verify ticket again shortly; no new ticket is needed.')
  throw error
 }
}

export function headerProgressText(progress:HeaderSyncProgress):string {
 if(progress.phase==='retrying')return `Shared header collection is retrying. ${progress.completed} of ${progress.total} headers saved on this device. You can cancel and resume later.`
 return progress.phase==='collecting'
  ? `Preparing shared verification data. ${progress.completed} of ${progress.total} headers saved on this device.`
  : `Preparing verification data: ${progress.completed} of ${progress.total} headers saved on this device.`
}
export const SHARED_HEADER_TRUST='Shared headers are compared by the TicketSV server. This device checks their checkpoint, linkage and declared-target proof of work. Full difficulty adjustment and best-chain selection are not checked.'
