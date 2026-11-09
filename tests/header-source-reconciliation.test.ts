import {expect,it,vi} from 'vitest'
import {collectHeaderRange} from '../server/header-sources.ts'
import {parseProviderHeader} from '../src/headers/validate.ts'
import a from './fixtures/headers/woc-1764333.json' with {type:'json'}
import b from './fixtures/headers/woc-1764334.json' with {type:'json'}
import c from './fixtures/headers/woc-1764335.json' with {type:'json'}
import orphan from './fixtures/headers/chaintracks-orphan-1764334.json' with {type:'json'}
import correct from './fixtures/headers/chaintracks-by-hash-1764334.json' with {type:'json'}
const headers=[a,b,c].map(h=>parseProviderHeader(h,'whatsonchain',h.height))
const wrong=parseProviderHeader(orphan.value,'chaintracks',b.height)
const bytes=(values:typeof headers)=>Uint8Array.from(Buffer.from(values.map(h=>h.hex).join(''),'hex'))
function sources(lookup:unknown=correct, tipDisagrees=false){
 return vi.fn(async(input)=>{
  const url=String(input)
  if(url.endsWith('/network'))return Response.json({status:'success',value:'test'})
  if(url.endsWith('/resources'))return Response.json({files:[`https://api.whatsonchain.com/v1/bsv/test/block/headers/${a.height}_${c.height}_headers.bin`]})
  if(url.includes('/header/hash/'))return Response.json(lookup)
  if(url.includes('/headers?'))return new Response(bytes(tipDisagrees?[headers[0],headers[1],wrong]:[headers[0],wrong,headers[2]]))
  return new Response(bytes(headers))
 }) as unknown as typeof fetch
}
it('resolves a height-index orphan only through the agreed child and exact hash lookup',async()=>{
 const get=sources()
 const result=await collectHeaderRange(a.height,3,new AbortController().signal,get)
 expect(result).toEqual(headers)
 expect(get).toHaveBeenCalledWith(expect.stringContaining('/header/hash/'+b.hash),expect.anything())
})
it('refuses a differing batch tip and refuses wrong-height or wrong-byte hash responses',async()=>{
 await expect(collectHeaderRange(a.height,3,new AbortController().signal,sources(correct,true))).rejects.toThrow()
 for(const lookup of [orphan,{...correct,value:{...correct.value,height:b.height+1}},{...correct,value:{...correct.value,nonce:0}}]){
  await expect(collectHeaderRange(a.height,3,new AbortController().signal,sources(lookup))).rejects.toThrow()
 }
})
it('keeps unresolved and unavailable hash lookups blocked',async()=>{
 await expect(collectHeaderRange(a.height,3,new AbortController().signal,sources({status:'error'}))).rejects.toThrow()
})
function laggingSources(chain=bytes(headers)){
 return vi.fn(async(input)=>{
  const url=String(input)
  if(url.endsWith('/network'))return Response.json({status:'success',value:'test'})
  if(url.endsWith('/resources'))return Response.json({files:[`https://api.whatsonchain.com/v1/bsv/test/block/headers/${a.height}_${a.height}_headers.bin`,'https://api.whatsonchain.com/v1/bsv/test/block/headers/latest']})
  if(url.includes('/headers?'))return new Response(chain)
  if(url.endsWith('/latest'))return new Response(new Uint8Array())
  if(url.endsWith(`/${b.height}/header`))return Response.json(b)
  if(url.endsWith(`/${c.height}/header`))return Response.json(c)
  return new Response(bytes([headers[0]]))
 }) as unknown as typeof fetch
}
it('fills only a bounded recent tail when binary files lag, still comparing both sources',async()=>{
 const get=laggingSources()
 expect(await collectHeaderRange(a.height,3,new AbortController().signal,get)).toEqual(headers)
 expect(get).toHaveBeenCalledWith(`https://api.whatsonchain.com/v1/bsv/test/block/${b.height}/header`,expect.anything())
})
it('blocks differing tail headers instead of trusting individual lookups alone',async()=>{
 await expect(collectHeaderRange(a.height,3,new AbortController().signal,laggingSources(bytes([headers[0],headers[1],wrong])))).rejects.toThrow(/disagree/)
})
it('never replaces a missing binary history with unbounded individual requests',async()=>{
 const get=laggingSources()
 await expect(collectHeaderRange(a.height,100,new AbortController().signal,get)).rejects.toThrow(/source files/)
 expect(get).not.toHaveBeenCalledWith(expect.stringMatching(/\/\d+\/header$/),expect.anything())
})
it('reuses bulk resources across successful collections but still fetches Chaintracks comparisons',async()=>{
 const get=sources()
 await collectHeaderRange(a.height,3,new AbortController().signal,get)
 await collectHeaderRange(a.height,3,new AbortController().signal,get)
 const calls=(get as ReturnType<typeof vi.fn>).mock.calls.map(([url])=>String(url))
 expect(calls.filter(url=>url.endsWith('/resources'))).toHaveLength(1)
 expect(calls.filter(url=>url.endsWith('_headers.bin'))).toHaveLength(1)
 expect(calls.filter(url=>url.includes('/headers?'))).toHaveLength(2)
 expect(calls.filter(url=>url.includes('/header/hash/'))).toHaveLength(2)
})
it('discards resource reuse after a source conflict so the next attempt reads fresh bytes',async()=>{
 const get=sources(correct,true)
 for(let i=0;i<2;i++)await expect(collectHeaderRange(a.height,3,new AbortController().signal,get)).rejects.toThrow()
 const calls=(get as ReturnType<typeof vi.fn>).mock.calls.map(([url])=>String(url))
 expect(calls.filter(url=>url.endsWith('_headers.bin'))).toHaveLength(2)
})
