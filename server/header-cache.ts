import type { Pool, PoolClient } from 'pg'
import { CHECKPOINT, HEADER_COLLECTION_WINDOW, validHeaderHeight } from '../src/headers/checkpoint.ts'
import { checkHeaderRange, HEADER_BATCH_SIZE } from '../src/headers/batch.ts'
import { appendSnapshot, validateSnapshot, type HeaderSnapshot } from '../src/headers/validate.ts'
import { collectHeaderRange, HeaderConflict, type HeaderResolution } from './header-sources.ts'
import { ApiError } from './events.ts'
const KEY = `testnet:${CHECKPOINT.height}:${CHECKPOINT.hash}`
export const HEADER_CACHE_KEY = KEY
const LOCK = 84723520
// Retain one immutable validated prefix per process. Database JSON is compared
// byte-for-byte before reuse, so an ID alone never establishes trust.
let accepted:HeaderSnapshot|undefined
function checkedSnapshot(value:HeaderSnapshot):HeaderSnapshot{
 const next=validateSnapshot(value,accepted);accepted=next;return next
}
export type CacheState = {
 network: 'testnet'; checkpoint: typeof CHECKPOINT; tip: number | null; target: number
 state: 'queued'|'collecting'|'ready'|'retrying'|'blocked'; error: string|null; checkedAt: string|null
}
type Row = { snapshot: HeaderSnapshot|null; target: number; state: CacheState['state']; error: string|null; retry_at: Date|null; checked_at: Date|null }
async function row(db: Pool|PoolClient): Promise<Row|undefined> { return (await db.query('SELECT * FROM header_cache WHERE cache_key=$1',[KEY])).rows[0] }
function state(value?: Row): CacheState {
 const snapshot=value?.snapshot ? checkedSnapshot(value.snapshot) : undefined
 return {network:'testnet',checkpoint:CHECKPOINT,tip:snapshot?.headers.at(-1)?.height??null,target:value?.target??CHECKPOINT.height,state:value?.state??'queued',error:value?.error??null,checkedAt:value?.checked_at?.toISOString()??null}
}
export async function readHeaderCache(pool:Pool):Promise<CacheState>{return state(await row(pool))}
// Progress is an untrusted scheduling hint; range serving still validates the
// actual retained snapshot before returning bytes. Polling never transfers it.
export async function readHeaderProgress(pool:Pool):Promise<CacheState>{
 const value=(await pool.query("SELECT target,state,error,checked_at,tip_height AS tip FROM header_cache WHERE cache_key=$1",[KEY])).rows[0]
 const tip=value?.tip??null,target=value?.target??CHECKPOINT.height
 if(tip!==null&&!validHeaderHeight(tip)||!validHeaderHeight(target))throw Error('Invalid shared header progress metadata.')
 return {network:'testnet',checkpoint:CHECKPOINT,tip,target,state:value?.state??'queued',error:value?.error??null,checkedAt:value?.checked_at?.toISOString()??null}
}
// The local scheduler only needs queue state. Do not hash the whole saved chain
// every two seconds while the application is idle.
export async function readHeaderWorkState(pool:Pool):Promise<{state:string}>{
 const result=await pool.query('SELECT state FROM header_cache WHERE cache_key=$1 AND (retry_at IS NULL OR retry_at<=now())',[KEY])
 return {state:result.rows[0]?.state??'idle'}
}
export async function requestHeaderHeight(pool:Pool,height:number,background=false):Promise<void>{
 if(!validHeaderHeight(height))throw new ApiError(400,'Invalid required header height.')
 // Clamp using the saved tip in the same atomic upsert as the target update.
 // A distant request buys one window, never a lifetime unbounded collection job.
 await pool.query(`INSERT INTO header_cache(cache_key,target) VALUES($1,LEAST($2::bigint,$3::bigint+$4::bigint))
 ON CONFLICT(cache_key) DO UPDATE SET
 target=GREATEST(header_cache.target,LEAST($2::bigint,COALESCE(header_cache.tip_height::bigint,$3::bigint)+$4::bigint)),
 state=CASE WHEN header_cache.state='ready' AND $2>header_cache.target THEN 'queued' ELSE header_cache.state END
 WHERE NOT $5::boolean OR header_cache.state<>'blocked'`,[KEY,height,CHECKPOINT.height,HEADER_COLLECTION_WINDOW,background])
}
export async function queueHeaders(pool:Pool,height:number):Promise<CacheState>{
 await requestHeaderHeight(pool,height)
 return readHeaderProgress(pool)
}
export async function cachedHeaderRange(pool:Pool,start:number,count:number):Promise<{bytes:Uint8Array;count:number;state:CacheState}>{
 try{checkHeaderRange(start,count)}catch{throw new ApiError(400,'Invalid header batch range.')}
 const value=await row(pool),status=state(value)
 if(status.state==='blocked')throw new ApiError(409,'Shared header history needs operator review; saved local data was not replaced.')
 if(!value?.snapshot||status.tip===null||start>status.tip)throw new ApiError(409,'Shared headers are still being prepared.')
 const snapshot=checkedSnapshot(value.snapshot)
 const headers=snapshot.headers.slice(start-CHECKPOINT.height,start-CHECKPOINT.height+count)
 return {bytes:Buffer.from(headers.map(h=>h.hex).join(''),'hex'),count:headers.length,state:status}
}
async function promote(db:PoolClient,snapshot:HeaderSnapshot,detail?:object){
 await db.query('BEGIN')
 try {
  await db.query("UPDATE header_cache SET snapshot=$2,tip_height=$3,checked_at=now(),retry_at=NULL,error=NULL,state=CASE WHEN target<=$3 THEN 'ready' ELSE 'queued' END WHERE cache_key=$1",[KEY,JSON.stringify(snapshot),snapshot.headers.at(-1)!.height])
  if(detail)await db.query('INSERT INTO header_cache_audit(cache_key,detail) VALUES($1,$2)',[KEY,JSON.stringify(detail)])
  await db.query('COMMIT')
 }catch(e){await db.query('ROLLBACK');throw e}
}
// Operator-only CLI recovery. It cannot discard or replace the retained prefix.
// Nothing is promoted until every requested header has been checked again.
export async function reviewBlockedHeaders(pool:Pool,signal:AbortSignal,get:typeof collectHeaderRange=collectHeaderRange):Promise<CacheState>{
 const db=await pool.connect();let locked=false
 try {
  signal.throwIfAborted()
  locked=(await db.query('SELECT pg_try_advisory_lock($1) AS locked',[LOCK])).rows[0].locked
  if(!locked)throw Error('Another header collector is active.')
  const value=await row(db)
  if(value?.state!=='blocked')throw Error('Explicit review requires a blocked cache.')
  const old=value.snapshot?checkedSnapshot(value.snapshot):undefined
  let checked:HeaderSnapshot|undefined
  const resolutions:HeaderResolution[]=[]
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(120_000)])
  for(let start=CHECKPOINT.height;start<=value.target;){
   const count=Math.min(HEADER_BATCH_SIZE,value.target-start+1)
   const batch=await get(start,count,bounded,fetch,r=>resolutions.push(r));bounded.throwIfAborted()
   if(batch.length!==count||batch[0]?.height!==start)throw Error('Review returned the wrong header range.')
   checked=appendSnapshot(checked,batch)
   start+=count
  }
  if(!checked || old?.headers.some((h,i)=>h.hex!==checked!.headers[i]?.hex))throw Error('Retained header history changed. Review cannot replace it.')
  bounded.throwIfAborted()
  await promote(db,checked,{kind:'explicit-review',previousError:value.error,previousSnapshot:old?.id??null,snapshot:checked.id,resolutions})
  return state(await row(db))
 }finally{
  let destroy=false
  if(locked)try{await db.query('SELECT pg_advisory_unlock($1)',[LOCK])}catch{destroy=true}
  db.release(destroy)
 }
}
// One bounded unit of background work. Advisory lock prevents duplicate workers;
// all writes are durable before return, and the UI's queue request does no fetching.
export async function collectHeadersTick(pool:Pool,signal:AbortSignal,get:typeof collectHeaderRange=collectHeaderRange):Promise<CacheState>{
 const db=await pool.connect();let locked=false
 try{
  signal.throwIfAborted()
  locked=(await db.query('SELECT pg_try_advisory_lock($1) AS locked',[LOCK])).rows[0].locked
  if(!locked)return state(await row(db))
  const value=await row(db)
  if(!value||value.state==='blocked'||value.retry_at&&value.retry_at.getTime()>Date.now())return state(value)
  const old=value.snapshot?checkedSnapshot(value.snapshot):undefined
  const tip=old?.headers.at(-1)?.height
  await db.query("UPDATE header_cache SET state='collecting',error=NULL WHERE cache_key=$1",[KEY])
  const start=tip??CHECKPOINT.height,count=Math.min(HEADER_BATCH_SIZE,Math.max(1,value.target-start+1))
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(25_000)])
  const resolutions:HeaderResolution[]=[]
  const headers=await get(start,count,bounded,fetch,r=>resolutions.push(r));bounded.throwIfAborted()
  let snapshot:HeaderSnapshot
  try{
   if(headers.length!==count||headers[0]?.height!==start)throw Error('Collector returned the wrong header range.')
   if(old && (headers[0].hex!==old.headers.at(-1)!.hex||headers[0].hash!==old.headers.at(-1)!.hash))throw Error('Saved header boundary changed.')
   snapshot=appendSnapshot(old,headers.slice(old?1:0))
  }catch(e){throw new HeaderConflict((e as Error).message)}
  bounded.throwIfAborted()
  await promote(db,snapshot,resolutions.length?{kind:'linked-ancestor-resolution',snapshot:snapshot.id,resolutions}:undefined)
  return state(await row(db))
 }catch(e){
  if(!locked)throw e
  await db.query('UPDATE header_cache SET state=$2,error=$3,retry_at=CASE WHEN $2=\'retrying\' THEN now()+interval \'60 seconds\' ELSE NULL END WHERE cache_key=$1',[KEY,e instanceof HeaderConflict?'blocked':'retrying',(e instanceof Error?e.message:'Header collection failed').slice(0,500)])
  return state(await row(db))
 }finally{
  let destroy=false
  if(locked)try{await db.query('SELECT pg_advisory_unlock($1)',[LOCK])}catch{destroy=true}
  db.release(destroy)
 }
}
