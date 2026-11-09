import type {Pool} from 'pg'
import {boundedBytes} from '../src/headers/batch.ts'
import {CHECKPOINT,validHeaderHeight} from '../src/headers/checkpoint.ts'
import {HEADER_CACHE_KEY,requestHeaderHeight} from './header-cache.ts'

// Tip metadata is only a scheduling hint. Actual collection still compares two
// sources, validates the chain and clamps each renewable collection window.
export async function prefetchHeaderTarget(pool:Pool,signal:AbortSignal,get:typeof fetch=fetch):Promise<void>{
 signal.throwIfAborted()
 await pool.query('INSERT INTO header_cache(cache_key,target) VALUES($1,$2) ON CONFLICT DO NOTHING',[HEADER_CACHE_KEY,CHECKPOINT.height])
 const claim=await pool.query(`UPDATE header_cache SET warm_checked_at=now(),warm_error=NULL
 WHERE cache_key=$1 AND state<>'blocked' AND (retry_at IS NULL OR retry_at<=now())
 AND (warm_checked_at IS NULL OR warm_checked_at<now()-interval '60 seconds') RETURNING cache_key`,[HEADER_CACHE_KEY])
 if(!claim.rowCount)return
 try{
  const bounded=AbortSignal.any([signal,AbortSignal.timeout(8000)])
  const response=await get('https://api.whatsonchain.com/v1/bsv/test/chain/info',{signal:bounded,credentials:'omit',redirect:'error',cache:'no-store'})
  const value=JSON.parse(new TextDecoder().decode(await boundedBytes(response,16384,bounded)))
  if(value?.chain!=='test'||!validHeaderHeight(value.blocks))throw Error('Invalid testnet height hint for header preparation.')
  bounded.throwIfAborted()
  await requestHeaderHeight(pool,value.blocks,true)
 }catch(error){
  await pool.query('UPDATE header_cache SET warm_error=$2 WHERE cache_key=$1',[HEADER_CACHE_KEY,(error instanceof Error?error.message:'Header prefetch failed').slice(0,500)])
  throw error
 }
}
