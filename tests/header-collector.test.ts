import {afterEach,expect,it,vi} from 'vitest'
import {startHeaderCollector} from '../server/header-collector.ts'
afterEach(()=>vi.useRealTimers())
it('does not collect ready or blocked work, serializes queued work, and aborts on shutdown',async()=>{
 vi.useFakeTimers()
 let state='ready',calls=0,aborted=false
 const read=async()=>({state})
 const collect=vi.fn(async(signal:AbortSignal)=>{calls++;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve()},{once:true}))})
 const stop=startHeaderCollector(read,collect,()=>{})
 await vi.advanceTimersByTimeAsync(6000);expect(calls).toBe(0)
 state='blocked';await vi.advanceTimersByTimeAsync(6000);expect(calls).toBe(0)
 state='queued';await vi.advanceTimersByTimeAsync(6000);expect(calls).toBe(1)
 await vi.advanceTimersByTimeAsync(6000);expect(calls).toBe(1)
 await stop();expect(aborted).toBe(true)
 await vi.advanceTimersByTimeAsync(6000);expect(calls).toBe(1)
})
it('reports failures without terminating future queue checks',async()=>{
 vi.useFakeTimers()
 const warn=vi.fn(),collect=vi.fn(async()=>{})
 const read=vi.fn().mockRejectedValueOnce(Error('database unavailable')).mockResolvedValue({state:'queued'})
 const stop=startHeaderCollector(read,collect,warn)
 await vi.advanceTimersByTimeAsync(4000)
 expect(warn).toHaveBeenCalled();expect(collect).toHaveBeenCalled()
 await stop()
})
it('prepares in the background at most once a minute and keeps collecting if tip discovery fails',async()=>{
 vi.useFakeTimers()
 const warm=vi.fn().mockRejectedValueOnce(Error('tip unavailable')).mockResolvedValue(undefined),warn=vi.fn(),collect=vi.fn(async()=>{})
 const stop=startHeaderCollector(async()=>({state:'queued'}),collect,warn,warm)
 await vi.advanceTimersByTimeAsync(10_000)
 expect(warm).toHaveBeenCalledTimes(1);expect(collect.mock.calls.length).toBeGreaterThan(1);expect(warn).toHaveBeenCalled()
 await vi.advanceTimersByTimeAsync(52_000)
 expect(warm).toHaveBeenCalledTimes(2)
 await stop();const calls=warm.mock.calls.length
 await vi.advanceTimersByTimeAsync(120_000);expect(warm).toHaveBeenCalledTimes(calls)
})
