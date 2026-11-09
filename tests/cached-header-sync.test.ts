import { afterEach, expect, it, vi } from 'vitest'
import a from './fixtures/headers/woc-1762324.json' with { type: 'json' }
import b from './fixtures/headers/woc-1762325.json' with { type: 'json' }
import { parseProviderHeader, makeSnapshot, validateSnapshot, type HeaderSnapshot } from '../src/headers/validate.ts'
import { syncCachedHeaders } from '../src/headers/cached-sync.ts'
import { CHECKPOINT } from '../src/headers/checkpoint.ts'
const records=[a,b].map(h=>parseProviderHeader(h,'whatsonchain',h.height))
const status={network:'testnet',checkpoint:CHECKPOINT,tip:b.height,target:b.height,state:'ready',error:null,checkedAt:new Date().toISOString()}
const body=Uint8Array.from(Buffer.from(records.map(h=>h.hex).join(''),'hex'))
function batch(bytes=body){return new Response(bytes,{headers:{'X-TicketSV-Header-Start':String(a.height),'X-TicketSV-Header-Count':'2','X-TicketSV-Header-Network':'testnet','X-TicketSV-Header-Checkpoint':CHECKPOINT.hash,'X-TicketSV-Header-Comparison':'server-reported'}})}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers()})
it('downloads a compact batch, validates it, and preserves cache provenance on disk',async()=>{
 const get=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('/range?')?batch():Response.json(status));vi.stubGlobal('fetch',get)
 let saved:HeaderSnapshot|undefined
 const result=await syncCachedHeaders(b.height,undefined,new AbortController().signal,undefined,async s=>{saved=s})
 expect(result.headers).toEqual(records);expect(saved?.source).toBe('ticketsv-cache')
 expect(validateSnapshot(saved).source).toBe('ticketsv-cache');expect(get).toHaveBeenCalledTimes(2)
 expect(get.mock.calls.every(([u])=>String(u).startsWith('/api/'))).toBe(true)
})
it('rechecks an existing boundary, does not overwrite on conflict or bad metadata',async()=>{
 const old=makeSnapshot([records[0]])
 for(const response of [batch(new Uint8Array(160)),new Response(body),batch(body.slice(1))]){
  let saved=false
  vi.stubGlobal('fetch',vi.fn(async(input)=>String(input).includes('/range?')?response:Response.json(status)))
  await expect(syncCachedHeaders(b.height,old,new AbortController().signal,undefined,async()=>{saved=true})).rejects.toThrow()
  expect(saved).toBe(false)
 }
})
it('refuses blocked cache and invalid targets without promoting bytes',async()=>{
 const get=vi.fn(async()=>Response.json({...status,state:'blocked'}));vi.stubGlobal('fetch',get)
 await expect(syncCachedHeaders(b.height,undefined,new AbortController().signal)).rejects.toThrow(/review|dispute/i)
 get.mockClear()
 await expect(syncCachedHeaders(Number.MAX_SAFE_INTEGER,undefined,new AbortController().signal)).rejects.toThrow()
 expect(get).not.toHaveBeenCalled()
})
it('cancels a cold cache wait promptly with no provider fallback',async()=>{
 const abort=new AbortController(),get=vi.fn(async()=>Response.json({...status,tip:null,state:'queued'}));vi.stubGlobal('fetch',get)
 await expect(syncCachedHeaders(b.height,undefined,abort.signal,()=>abort.abort(Error('cancelled')))).rejects.toThrow('cancelled')
 expect(get).toHaveBeenCalledTimes(1)
})
it('bounds the initial preparation body and cancels a stalled body',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(' '.repeat(16385))))
 await expect(syncCachedHeaders(b.height,undefined,new AbortController().signal)).rejects.toThrow(/size/)
 const controller=new AbortController();let cancelled=false
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(){setTimeout(()=>controller.abort(Error('cancelled')),5)},cancel(){cancelled=true}}))))
 await expect(syncCachedHeaders(b.height,undefined,controller.signal)).rejects.toThrow('cancelled')
 expect(cancelled).toBe(true)
})
it('keeps cache provenance when legacy direct sync extends or rechecks a cached prefix',async()=>{
 const {syncHeaders}=await import('../src/headers/sync.ts')
 const old=makeSnapshot([records[0]],undefined,'ticketsv-cache')
 const get=async(_provider:unknown,height:number)=>records.find(r=>r.height===height)!
 expect((await syncHeaders(b.height,old,get,new AbortController().signal)).snapshot.source).toBe('ticketsv-cache')
 expect((await syncHeaders(b.height,old,get,new AbortController().signal,undefined,{fullRefresh:true})).snapshot.source).toBeUndefined()
})
it('uses the cookie session identity for handoff preparation without changing client auth state',async()=>{
 const {currentAuthIdentity,currentAuthEpoch}=await import('../src/auth/api.ts')
 const before={identity:currentAuthIdentity(),epoch:currentAuthEpoch()},identityKey='02'+'11'.repeat(32)
 const get=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input)==='/api/auth/session')return Response.json({identityKey,network:'testnet',expiresAt:new Date(Date.now()+60000).toISOString()})
  if(String(input).includes('/range?'))return batch()
  if(new Headers(init?.headers).get('x-ticketsv-identity')!==identityKey)return Response.json({error:'The signed-in account changed. Reload your events before saving.'},{status:409})
  return Response.json(status)
 });vi.stubGlobal('fetch',get)
 const result=await syncCachedHeaders(b.height,undefined,new AbortController().signal,undefined,undefined,{useCookieSession:true})
 expect(result.headers).toEqual(records)
 expect(get).toHaveBeenCalledTimes(3)
 expect({identity:currentAuthIdentity(),epoch:currentAuthEpoch()}).toEqual(before)
})

it('renews a completed collection window and resumes after a later download fails',async()=>{
 let saved:HeaderSnapshot|undefined,preparations=0,fail=true
 const ranges:string[]=[]
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input)
  if(!url.includes('/range?')){if(init?.method==='POST')preparations++;return Response.json({...status,target:preparations===1?a.height:b.height,tip:preparations===1?a.height:b.height})}
  ranges.push(url)
  if(url.endsWith('count=1'))return new Response(body.slice(0,80),{headers:{'X-TicketSV-Header-Start':String(a.height),'X-TicketSV-Header-Count':'1','X-TicketSV-Header-Network':'testnet','X-TicketSV-Header-Checkpoint':CHECKPOINT.hash,'X-TicketSV-Header-Comparison':'server-reported'}})
  if(fail)throw new TypeError('temporary connection failure')
  return batch()
 }))
 await expect(syncCachedHeaders(b.height,undefined,new AbortController().signal,undefined,async s=>{saved=s})).rejects.toThrow('temporary')
 expect(saved?.headers).toEqual([records[0]])
 expect(preparations).toBe(2)
 fail=false
 const next=await syncCachedHeaders(b.height,saved,new AbortController().signal,undefined,async s=>{saved=s})
 expect(next.headers).toEqual(records)
 expect(ranges).toEqual([`/api/headers/range?start=${a.height}&count=1`,`/api/headers/range?start=${a.height}&count=2`,`/api/headers/range?start=${a.height}&count=2`])
})
it('reuses available validated cache bytes during a temporary collector retry',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(input)=>String(input).includes('/range?')?batch():Response.json({...status,state:'retrying'})))
 const saved=vi.fn()
 const result=await syncCachedHeaders(b.height,undefined,new AbortController().signal,undefined,saved)
 expect(result.headers).toEqual(records)
 expect(saved).toHaveBeenCalledTimes(1)
})

it('waits through temporary retries and can still be cancelled without another preparation request',async()=>{
 const abort=new AbortController(),progress=vi.fn(p=>{if(p.phase==='retrying')abort.abort(Error('cancelled'))})
 const get=vi.fn(async()=>Response.json({...status,tip:null,state:'retrying'}));vi.stubGlobal('fetch',get)
 await expect(syncCachedHeaders(b.height,undefined,abort.signal,progress)).rejects.toThrow('cancelled')
 expect(progress).toHaveBeenCalledWith(expect.objectContaining({phase:'retrying'}))
 expect(get).toHaveBeenCalledTimes(1)
})
