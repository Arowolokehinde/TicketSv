import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../server/database.ts'
import { queueHeaders, readHeaderCache, collectHeadersTick, cachedHeaderRange, readHeaderWorkState } from '../server/header-cache.ts'
import { HeaderConflict } from '../server/header-sources.ts'
import { parseProviderHeader } from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1762324.json' with { type: 'json' }
import b from './fixtures/headers/woc-1762325.json' with { type: 'json' }
const records=[a,b].map(h=>parseProviderHeader(h,'whatsonchain',h.height))
describe.skipIf(!process.env.TEST_DATABASE_URL)('shared PostgreSQL headers',()=>{
 let pool:Pool
 beforeAll(async()=>{pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});await migrate(pool)})
 afterAll(async()=>{await pool?.end()})
 it('backfills progress metadata without replacing an existing accepted snapshot',async()=>{
  await queueHeaders(pool,a.height)
  await collectHeadersTick(pool,new AbortController().signal,async()=>[records[0]])
  const before=(await pool.query('SELECT snapshot FROM header_cache')).rows[0].snapshot
  // Simulate upgrading an existing version-5 database, in this isolated fixture.
  await pool.query('ALTER TABLE header_cache DROP COLUMN tip_height,DROP COLUMN warm_checked_at,DROP COLUMN warm_error')
  await pool.query('DELETE FROM ticketsv_migrations WHERE version=6')
  await migrate(pool)
  const after=(await pool.query('SELECT snapshot,tip_height FROM header_cache')).rows[0]
  expect(after.snapshot).toEqual(before);expect(after.tip_height).toBe(a.height)
 })
 it('shares a monotonic target and collects once under concurrent workers',async()=>{
  await expect(queueHeaders(pool,Number.MAX_SAFE_INTEGER)).rejects.toThrow()
  await Promise.all([queueHeaders(pool,b.height),queueHeaders(pool,a.height)])
  expect((await readHeaderCache(pool)).target).toBe(b.height)
  let entered!:()=>void,release!:()=>void,calls=0
  const running=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r)
  const job=collectHeadersTick(pool,new AbortController().signal,async(start,count)=>{calls++;entered();await held;return records.slice(start-a.height,start-a.height+count)})
  await running
  expect((await collectHeadersTick(pool,new AbortController().signal,async()=>{throw Error('must not run')})).state).toBe('collecting')
  release();await job
  expect(calls).toBe(1)
  const state=await readHeaderCache(pool);expect(state.tip).toBe(b.height);expect(state.state).toBe('ready')
  const range=await cachedHeaderRange(pool,a.height,2)
  expect(Buffer.from(range.bytes).toString('hex')).toBe(records.map(h=>h.hex).join(''))
  await expect(cachedHeaderRange(pool,a.height,513)).rejects.toThrow()
 })
 it('rechecks a ready boundary and blocks a changed upstream history',async()=>{
  let calls=0
  await collectHeadersTick(pool,new AbortController().signal,async(start,count)=>{calls++;expect(start).toBe(b.height);expect(count).toBe(1);return [records[1]]})
  expect(calls).toBe(1);expect((await readHeaderCache(pool)).state).toBe('ready')
  await collectHeadersTick(pool,new AbortController().signal,async()=>[{...records[0],height:b.height}])
  expect((await readHeaderCache(pool)).state).toBe('blocked')
  await expect(cachedHeaderRange(pool,a.height,2)).rejects.toThrow(/review/)
  // Reset only this disposable fixture for the remaining failure scenarios.
  await pool.query("UPDATE header_cache SET state='ready'")
 })
 it('retains a valid prefix on failure, and blocks serving disputed history',async()=>{
  await queueHeaders(pool,b.height+1)
  await collectHeadersTick(pool,new AbortController().signal,async()=>{throw Error('temporary outage')})
  expect((await readHeaderCache(pool)).tip).toBe(b.height)
  expect((await readHeaderCache(pool)).state).toBe('retrying')
  expect((await readHeaderWorkState(pool)).state).toBe('idle')
  await pool.query('UPDATE header_cache SET retry_at=NULL')
  await collectHeadersTick(pool,new AbortController().signal,async()=>{throw new HeaderConflict('sources disagree')})
  expect((await readHeaderCache(pool)).state).toBe('blocked')
  await expect(cachedHeaderRange(pool,a.height,2)).rejects.toThrow(/review/i)
  const state=await readHeaderCache(pool);expect(state.tip).toBe(b.height)
  await collectHeadersTick(pool,new AbortController().signal,async()=>{throw Error('must not retry blocked')})
  expect((await readHeaderCache(pool)).state).toBe('blocked')
 })
 it('cancellation and changed boundary cannot replace the existing prefix',async()=>{
  await pool.query("UPDATE header_cache SET state='queued',retry_at=NULL")
  const abort=new AbortController()
  await collectHeadersTick(pool,abort.signal,async()=>{abort.abort(Error('cancel'));return records})
  expect((await readHeaderCache(pool)).tip).toBe(b.height)
  await pool.query('UPDATE header_cache SET retry_at=NULL')
  await collectHeadersTick(pool,new AbortController().signal,async()=>[{...records[0],height:b.height}])
  expect((await readHeaderCache(pool)).state).toBe('blocked')
  expect((await readHeaderCache(pool)).tip).toBe(b.height)
 })
 it('reviews blocked history atomically, preserving the incident and rejecting replacement of its prefix',async()=>{
  const {reviewBlockedHeaders}=await import('../server/header-cache.ts')
  // Use the same public two-header fixture and a deliberately blocked cache.
  await pool.query("UPDATE header_cache SET target=$1,state='blocked',error='recorded source discrepancy'",[b.height])
  await expect(reviewBlockedHeaders(pool,new AbortController().signal,async()=>[{...records[0],hash:'00'.repeat(32)},records[1]])).rejects.toThrow()
  expect((await readHeaderCache(pool)).state).toBe('blocked')
  expect((await readHeaderCache(pool)).error).toBe('recorded source discrepancy')
  const result=await reviewBlockedHeaders(pool,new AbortController().signal,async()=>records)
  expect(result.state).toBe('ready');expect(result.tip).toBe(b.height)
  const audit=await pool.query("SELECT detail FROM header_cache_audit ORDER BY id DESC LIMIT 1")
  expect(audit.rows[0].detail.previousError).toBe('recorded source discrepancy')
  expect(audit.rows[0].detail.kind).toBe('explicit-review')
  await expect(reviewBlockedHeaders(pool,new AbortController().signal,async()=>records)).rejects.toThrow(/blocked/)
 })

 it('rolls back audit failure and retains a concurrent higher requested target',async()=>{
  const {reviewBlockedHeaders}=await import('../server/header-cache.ts')
  await pool.query("UPDATE header_cache SET target=$1,state='blocked',error='retain incident'",[b.height])
  const before=(await pool.query('SELECT snapshot,state,error,checked_at FROM header_cache')).rows
  await pool.query("CREATE FUNCTION fail_header_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit unavailable'; END $$")
  await pool.query('CREATE TRIGGER fail_header_audit BEFORE INSERT ON header_cache_audit FOR EACH ROW EXECUTE FUNCTION fail_header_audit()')
  try{
   await expect(reviewBlockedHeaders(pool,new AbortController().signal,async()=>records)).rejects.toThrow('audit unavailable')
   expect((await pool.query('SELECT snapshot,state,error,checked_at FROM header_cache')).rows).toEqual(before)
  }finally{await pool.query('DROP FUNCTION fail_header_audit() CASCADE')}
  const abort=new AbortController()
  await expect(reviewBlockedHeaders(pool,abort.signal,async()=>{abort.abort(Error('cancel review'));return records})).rejects.toThrow('cancel review')
  expect((await readHeaderCache(pool)).error).toBe('retain incident')
  let release!:()=>void,entered!:()=>void
  const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r)
  const review=reviewBlockedHeaders(pool,new AbortController().signal,async()=>{entered();await held;return records})
  await started
  await queueHeaders(pool,b.height+1)
  release()
  const result=await review
  expect(result.state).toBe('queued');expect(result.target).toBe(b.height+1);expect(result.tip).toBe(b.height)
 })

 it('caps repeated distant requests at one window beyond the saved tip',async()=>{
  const before=await readHeaderCache(pool)
  try{
   await queueHeaders(pool,2000000)
   const queued=await readHeaderCache(pool)
   expect(queued.tip).toBe(b.height)
   expect(queued.target).toBe(1766421)
   await queueHeaders(pool,2100000)
   expect((await readHeaderCache(pool)).target).toBe(1766421)
  }finally{await pool.query('UPDATE header_cache SET target=$1,state=$2',[before.target,before.state])}
 })

 it('claims background preparation once across workers and leaves blocked history untouched',async()=>{
  const {prefetchHeaderTarget}=await import('../server/header-prefetch.ts')
  const {readHeaderProgress}=await import('../server/header-cache.ts')
  await pool.query("UPDATE header_cache SET state='ready',target=$1,retry_at=NULL,warm_checked_at=NULL",[b.height])
  const before=(await pool.query('SELECT snapshot FROM header_cache')).rows[0].snapshot
  let calls=0
  const get=async()=>{calls++;return Response.json({chain:'test',blocks:b.height+1})}
  await Promise.all([prefetchHeaderTarget(pool,new AbortController().signal,get),prefetchHeaderTarget(pool,new AbortController().signal,get)])
  expect(calls).toBe(1)
  expect(await readHeaderProgress(pool)).toMatchObject({state:'queued',target:b.height+1,tip:b.height})
  expect((await pool.query('SELECT snapshot FROM header_cache')).rows[0].snapshot).toEqual(before)
  await pool.query("UPDATE header_cache SET state='blocked',warm_checked_at=NULL,error='retain dispute'")
  await prefetchHeaderTarget(pool,new AbortController().signal,get)
  expect(calls).toBe(1);expect((await readHeaderCache(pool)).error).toBe('retain dispute')
 })

 it('does not advance a background target if history becomes blocked during discovery',async()=>{
  const {prefetchHeaderTarget}=await import('../server/header-prefetch.ts')
  await pool.query("UPDATE header_cache SET state='ready',target=$1,retry_at=NULL,warm_checked_at=NULL",[b.height])
  await prefetchHeaderTarget(pool,new AbortController().signal,async()=>{
   await pool.query("UPDATE header_cache SET state='blocked',error='new dispute'")
   return Response.json({chain:'test',blocks:b.height+100})
  })
  const result=await readHeaderCache(pool)
  expect(result.target).toBe(b.height);expect(result.state).toBe('blocked');expect(result.error).toBe('new dispute')
 })

})
