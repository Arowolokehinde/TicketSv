import { it, expect, vi } from 'vitest'
import a from './fixtures/headers/woc-1762324.json' with { type: 'json' }
import b from './fixtures/headers/woc-1762325.json' with { type: 'json' }
import { parseProviderHeader, makeSnapshot } from '../src/headers/validate.ts'
import { syncHeaders, fetchProviderHeader, pacedHeaderFetcher } from '../src/headers/sync.ts'
const records=[parseProviderHeader(a,'whatsonchain',a.height),parseProviderHeader(b,'whatsonchain',b.height)]
const previous=makeSnapshot(records)
it('reuses validated history, rechecks only its tip when covered, and never shrinks the snapshot',async()=>{
 const get=vi.fn(async (_p:string,h:number)=>records[h-a.height])
 const result=await syncHeaders(a.height,previous,get,new AbortController().signal)
 expect(result.snapshot.headers).toHaveLength(2); expect(get.mock.calls.map(c=>c[1])).toEqual([b.height,b.height])
 expect(result.affectedHeights).toEqual([])
})
it('extends a saved prefix by requesting only its boundary and missing headers',async()=>{
 const get=vi.fn(async(_p:string,h:number)=>records[h-a.height])
 const result=await syncHeaders(b.height,makeSnapshot([records[0]]),get,new AbortController().signal)
 expect(result.snapshot.headers).toEqual(records)
 expect(get.mock.calls.map(c=>c[1])).toEqual([a.height,a.height,b.height,b.height])
})
it('saves a validated prefix before a later source failure and resumes from that saved boundary',async()=>{
 let saved:typeof previous|undefined
 const get=vi.fn(async(_p:string,h:number)=>{if(h===b.height)throw new Error('interrupted');return records[0]})
 await expect(syncHeaders(b.height,undefined,get,new AbortController().signal,undefined,{onCheckpoint:async s=>{saved=s}})).rejects.toThrow('interrupted')
 expect(saved?.headers).toEqual([records[0]])
 const resumed=await syncHeaders(b.height,saved,async(_p,h)=>records[h-a.height],new AbortController().signal)
 expect(resumed.snapshot.headers).toEqual(records)
})
it('stops on changed saved boundary and allows an explicit full recheck',async()=>{
 const get=vi.fn(async(_p:string,h:number)=>({...records[h-a.height],hash:'00'.repeat(32)}))
 await expect(syncHeaders(b.height,previous,get,new AbortController().signal)).rejects.toThrow(/saved.*changed|boundary/i)
 const full=vi.fn(async(_p:string,h:number)=>records[h-a.height])
 await syncHeaders(b.height,previous,full,new AbortController().signal,undefined,{fullRefresh:true})
 expect(full.mock.calls.map(c=>c[1])).toEqual([a.height,a.height,b.height,b.height])
})
it('never checkpoints matching but invalid or unlinked provider headers',async()=>{
 const saved:unknown[]=[]
 await expect(syncHeaders(b.height,makeSnapshot([records[0]]),async(_p,h)=>h===a.height?records[0]:{...records[0],height:b.height},new AbortController().signal,undefined,{onCheckpoint:async s=>{saved.push(s)}})).rejects.toThrow(/linkage/i)
 expect(saved).toEqual([])
 await expect(syncHeaders(a.height,undefined,async()=>({...records[0],hex:'00'.repeat(80)}),new AbortController().signal,undefined,{onCheckpoint:async s=>{saved.push(s)}})).rejects.toThrow()
 expect(saved).toEqual([])
})
it('does not publish partial replacement history during a full recheck',async()=>{
 const saved:unknown[]=[]
 await expect(syncHeaders(b.height,previous,async(_p,h)=>{if(h===b.height)throw new Error('unavailable');return records[0]},new AbortController().signal,undefined,{fullRefresh:true,onCheckpoint:async s=>{saved.push(s)}})).rejects.toThrow('unavailable')
 expect(saved).toEqual([])
})
it('rejects disagreement and does not mutate the accepted snapshot',async()=>{
 const before=JSON.stringify(previous)
 await expect(syncHeaders(b.height,previous,async(p,h)=>({...records[h-a.height],hash:p==='chaintracks'?'00'.repeat(32):records[h-a.height].hash}),new AbortController().signal)).rejects.toThrow(/disagree/i)
 expect(JSON.stringify(previous)).toBe(before)
})
it('fails on unavailable sources, aborted work and excessive ranges',async()=>{
 const get=vi.fn(async()=>{throw new Error('unavailable')})
 await expect(syncHeaders(b.height,undefined,get,new AbortController().signal)).rejects.toThrow('unavailable')
 const c=new AbortController();c.abort();get.mockClear()
 await expect(syncHeaders(b.height,undefined,get,c.signal)).rejects.toThrow()
 expect(get).not.toHaveBeenCalled()
 await expect(syncHeaders(Number.MAX_SAFE_INTEGER,undefined,get,new AbortController().signal)).rejects.toThrow(/range/i)
})
it('allows the fresh ticket anchor 1764620 to begin cross-checking from the original checkpoint',async()=>{
 const get=vi.fn(async()=>{throw new Error('source reached')})
 await expect(syncHeaders(1764620,undefined,get,new AbortController().signal)).rejects.toThrow('source reached')
 expect(get.mock.calls).toHaveLength(2)
})
it('reports progress only after both sources agree and aborts without publishing partial progress',async()=>{
 const progress:unknown[]=[]
 await syncHeaders(b.height,undefined,async(_p,h)=>records[h-a.height],new AbortController().signal,p=>progress.push(p))
 expect(progress).toEqual([{completed:1,total:2,height:a.height},{completed:2,total:2,height:b.height}])
 const rejected:unknown[]=[]
 await expect(syncHeaders(b.height,undefined,async(p,h)=>({...records[h-a.height],hash:p==='chaintracks'?'00'.repeat(32):records[h-a.height].hash}),new AbortController().signal,p=>rejected.push(p))).rejects.toThrow(/disagree/i)
 expect(rejected).toEqual([])
})
it('logs only fixed provider/height/status and validates returned bytes',async()=>{
 const log:unknown[]=[]
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify(b),{status:200}))
 try {
  expect(await fetchProviderHeader('whatsonchain',b.height,new AbortController().signal,e=>log.push(e))).toEqual(records[1])
  expect(log).toHaveLength(1);expect(JSON.stringify(log)).not.toContain('nonce')
  expect(fetch.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error'})
 }finally{fetch.mockRestore()}
})
it('rejects oversized provider bodies and logs failure',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('x'.repeat(17000)))
 const log: {status:string}[]=[]
 try {
  await expect(fetchProviderHeader('whatsonchain',b.height,new AbortController().signal,e=>log.push(e))).rejects.toThrow(/size/i)
  expect(log[0].status).toBe('failed')
 }finally{fetch.mockRestore()}
})
it.each(['operator','deadline'])('cancels a stalled response body on %s without returning evidence later',async(mode)=>{
 const c=new AbortController();let started!:()=>void;const ready=new Promise<void>(r=>{started=r})
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{started();return new Response(new ReadableStream({start(){}}))})
 const log: {status:string}[]=[]
 const deadline=mode==='deadline'?vi.spyOn(AbortSignal,'timeout').mockReturnValue(c.signal):undefined
 try{
  const work=fetchProviderHeader('whatsonchain',b.height,mode==='operator'?c.signal:new AbortController().signal,e=>log.push(e)).then(()=> 'success',()=> 'aborted')
  await ready;await new Promise(r=>setTimeout(r,0));c.abort()
  expect(await Promise.race([work,new Promise(r=>setTimeout(()=>r('still pending'),30))])).toBe('aborted')
  expect(log[0].status).toBe('failed')
 }finally{fetch.mockRestore();deadline?.mockRestore()}
})
it('rejects a late header result after active sync cancellation',async()=>{
 const c=new AbortController();let release!:()=>void;const held=new Promise<void>(r=>{release=r})
 const work=syncHeaders(b.height,previous,async(_p,h)=>{await held;return records[h-a.height]},c.signal)
 c.abort();release();await expect(work).rejects.toThrow()
})
it('retries a transport failure at the same height and records both attempts',async()=>{
 vi.useFakeTimers()
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async()=>new Response(JSON.stringify(b)))
 const log:unknown[]=[]
 try{
  const result=pacedHeaderFetcher(e=>log.push(e))('whatsonchain',b.height,new AbortController().signal).then(value=>({value}),error=>({error}))
  await vi.runAllTimersAsync()
  expect(await result).toEqual({value:records[1]})
  expect(log).toMatchObject([{provider:'whatsonchain',height:b.height,status:'failed',attempt:1,failure:'network'},{provider:'whatsonchain',height:b.height,status:'ok',attempt:2}])
 }finally{fetch.mockRestore();vi.useRealTimers()}
})
it('bounds temporary server retries and reports the provider and height on exhaustion',async()=>{
 vi.useFakeTimers();const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('unavailable',{status:503}))
 const log:unknown[]=[]
 try{
  const result=pacedHeaderFetcher(e=>log.push(e))('whatsonchain',b.height,new AbortController().signal).catch(e=>e)
  await vi.runAllTimersAsync()
  expect((await result).message).toMatch(/whatsonchain.*1762325.*503.*3 attempts/i)
  expect(log).toHaveLength(3)
 }finally{fetch.mockRestore();vi.useRealTimers()}
})
it.each([400,'invalid' as const])('does not retry permanent/invalid header response %s',async response=>{
 vi.useFakeTimers();const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response===400?new Response('',{status:400}):new Response(JSON.stringify({...b,hash:'00'.repeat(32)})))
 const log:unknown[]=[]
 try{
  const result=pacedHeaderFetcher(e=>log.push(e))('whatsonchain',b.height,new AbortController().signal).catch(e=>e)
  await vi.runAllTimersAsync();expect(await result).toBeInstanceOf(Error);expect(log).toHaveLength(1)
 }finally{fetch.mockRestore();vi.useRealTimers()}
})
it('cancels retry backoff without sending another request',async()=>{
 vi.useFakeTimers();const c=new AbortController(),fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
 const log:unknown[]=[]
 try{
  const result=pacedHeaderFetcher(e=>log.push(e))('chaintracks',b.height,c.signal).catch(e=>e)
  await vi.advanceTimersByTimeAsync(1);c.abort(new Error('operator cancelled'));await vi.runAllTimersAsync()
  expect((await result).message).toContain('operator cancelled');expect(log).toHaveLength(1)
 }finally{fetch.mockRestore();vi.useRealTimers()}
})
it('honors an exposed Retry-After delay before retrying a rate-limited source',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100000);const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('',{status:429,headers:{'Retry-After':'10'}})).mockImplementation(async()=>new Response(JSON.stringify(b)))
 const log:unknown[]=[]
 try{
  const result=pacedHeaderFetcher(e=>log.push(e))('whatsonchain',b.height,new AbortController().signal)
  await vi.advanceTimersByTimeAsync(0);expect(log).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(9999);expect(log).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(1);expect(await result).toEqual(records[1]);expect(log).toHaveLength(2)
 }finally{fetch.mockRestore();vi.useRealTimers()}
})
it('does not retry early when the source requests a wait beyond the bounded automatic delay',async()=>{
 vi.useFakeTimers();const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('',{status:429,headers:{'Retry-After':'120'}}))
 const log:unknown[]=[]
 try{
  const result=pacedHeaderFetcher(e=>log.push(e))('chaintracks',b.height,new AbortController().signal).catch(e=>e)
  await vi.runAllTimersAsync();expect((await result).message).toContain('longer wait');expect(log).toHaveLength(1)
 }finally{fetch.mockRestore();vi.useRealTimers()}
})
