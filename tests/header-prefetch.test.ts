import {expect,it,vi} from 'vitest'
import {prefetchHeaderTarget} from '../server/header-prefetch.ts'
import type {Pool} from 'pg'
import {CHECKPOINT,HEADER_COLLECTION_WINDOW} from '../src/headers/checkpoint.ts'
function database(claim=true){
 const query=vi.fn(async(sql:string,_params?:unknown[])=>({rows:sql.includes('RETURNING')&&claim?[{cache_key:'fixture'}]:[],rowCount:sql.includes('RETURNING')&&claim?1:0}))
 return {pool:{query} as unknown as Pool,query}
}
it('discovers a bounded background target once, without accepting tip metadata as headers',async()=>{
 const db=database(),get=vi.fn(async()=>Response.json({chain:'test',blocks:CHECKPOINT.height+9000}))
 await prefetchHeaderTarget(db.pool,new AbortController().signal,get)
 expect(get).toHaveBeenCalledTimes(1)
 const update=db.query.mock.calls.find(([sql])=>sql.includes('GREATEST'))
 expect(update?.[0]).toContain('LEAST')
 expect(update?.[1]).toEqual(expect.arrayContaining([CHECKPOINT.height+9000,HEADER_COLLECTION_WINDOW]))
 expect(db.query.mock.calls.some(([sql])=>sql.includes('snapshot='))).toBe(false)
})
it('skips discovery when another worker already claimed it, or the cache is blocked',async()=>{
 const db=database(false),get=vi.fn()
 await prefetchHeaderTarget(db.pool,new AbortController().signal,get)
 expect(get).not.toHaveBeenCalled()
 expect(db.query.mock.calls.find(([sql])=>sql.includes('RETURNING'))?.[0]).toContain("state<>'blocked'")
})
it('rejects wrong-network and invalid height hints without changing the collection target',async()=>{
 for(const value of [{chain:'main',blocks:CHECKPOINT.height},{chain:'test',blocks:Number.MAX_SAFE_INTEGER}]){
  const db=database()
  await expect(prefetchHeaderTarget(db.pool,new AbortController().signal,async()=>Response.json(value))).rejects.toThrow()
  expect(db.query.mock.calls.some(([sql])=>sql.includes('GREATEST'))).toBe(false)
 }
})
