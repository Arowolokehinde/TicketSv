import {expect,it,vi} from 'vitest'
import {offlineBuild} from '../scripts/offline-build.ts'
function worker(){
 const outputs:{fileName:string;source:string}[]=[]
 const hook=offlineBuild().generateBundle!
 const run=(typeof hook==='function'?hook:hook.handler) as Function
 run.call({emitFile:(asset:{fileName:string;source:string})=>outputs.push(asset)}, {},{
  'index.html':{type:'asset',source:'<html>Scanner</html>'},'assets/app.js':{type:'chunk',code:'/* synthetic app */'},
 })
 const source=outputs.find(x=>x.fileName==='scanner-offline-worker.js')!.source
 const handlers:Record<string,(e:Record<string,unknown>)=>void>={}
 const match=vi.fn(async(path:string)=>new Response(path==='index.html'?'Scanner':'Cached file'))
 const addAll=vi.fn(),get=vi.fn(),cache={match,addAll}
 const self={location:{origin:'https://scanner.example'},addEventListener:(name:string,handler:(e:Record<string,unknown>)=>void)=>{handlers[name]=handler}}
 new Function('self','caches','fetch',source)(self,{open:async()=>cache,keys:async()=>[]},get)
 return {handlers,match,addAll,get}
}
it('checks scanner cache readiness without fetching missing files',async()=>{
 const w=worker(),postMessage=vi.fn(),pending:Promise<unknown>[]=[]
 w.handlers.message({data:'CHECK_SCANNER_CACHE',ports:[{postMessage}],waitUntil:(p:Promise<unknown>)=>pending.push(p)})
 await Promise.all(pending);expect(postMessage).toHaveBeenCalledWith({ready:true})
 expect(w.get).not.toHaveBeenCalled();expect(w.addAll).not.toHaveBeenCalled()
 w.match.mockResolvedValueOnce(undefined as unknown as Response)
 pending.length=0;w.handlers.message({data:'CHECK_SCANNER_CACHE',ports:[{postMessage}],waitUntil:(p:Promise<unknown>)=>pending.push(p)})
 await Promise.all(pending);expect(postMessage).toHaveBeenLastCalledWith({ready:false});expect(w.addAll).not.toHaveBeenCalled()
})
it('serves scanner and preparation deep links from the cached shell without network fallback',async()=>{
 const w=worker()
 for(const path of ['/scanner','/scanner/','/scanner/prepare']){
  let result:Promise<Response>|undefined
  w.handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://scanner.example'+path},respondWith:(response:Promise<Response>)=>{result=response}})
  expect((await result!).status).toBe(200)
 }
 expect(w.match.mock.calls.every(([key])=>key==='/index.html')).toBe(true)
 expect(w.get).not.toHaveBeenCalled()
})
