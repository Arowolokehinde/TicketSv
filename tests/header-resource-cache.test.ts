import {expect,it,vi} from 'vitest'
import {createHeaderResourceCache} from '../server/header-resource-cache.ts'
it('reuses successful resource bytes, expires them and isolates callers from mutation',async()=>{
 let now=0
 const cache=createHeaderResourceCache(()=>now,10),load=vi.fn(async()=>new Uint8Array([1,2,3])),signal=new AbortController().signal
 const first=await cache.read('a',100,signal,load);first[0]=9
 expect(await cache.read('a',100,signal,load)).toEqual(new Uint8Array([1,2,3]));expect(load).toHaveBeenCalledTimes(1)
 now=101;await cache.read('a',100,signal,load);expect(load).toHaveBeenCalledTimes(2)
})
it('bounds retained bytes and never caches failures or an aborted result',async()=>{
 const cache=createHeaderResourceCache(()=>0,3),signal=new AbortController().signal
 const load=vi.fn(async()=>new Uint8Array([1,2]))
 await cache.read('a',100,signal,load);await cache.read('b',100,signal,load);await cache.read('a',100,signal,load)
 expect(load).toHaveBeenCalledTimes(3)
 const bad=vi.fn(async()=>{throw Error('temporary outage')})
 await expect(cache.read('bad',100,signal,bad)).rejects.toThrow();await expect(cache.read('bad',100,signal,bad)).rejects.toThrow();expect(bad).toHaveBeenCalledTimes(2)
 const abort=new AbortController()
 await expect(cache.read('cancel',100,abort.signal,async()=>{abort.abort(Error('cancel'));return new Uint8Array([1])})).rejects.toThrow('cancel')
 const replacement=vi.fn(async()=>new Uint8Array([2]))
 expect(await cache.read('cancel',100,signal,replacement)).toEqual(new Uint8Array([2]))
})
