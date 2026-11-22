import {afterEach,expect,it,vi} from 'vitest'
import {attendeeAppStatus} from '../src/offline/attendee-cache.ts'
afterEach(()=>vi.unstubAllGlobals())
function registration(ready=true,waiting=false){
 const postMessage=vi.fn((message:string,ports:MessagePort[])=>{expect(message).toBe('CHECK_APP_CACHE');ports[0].postMessage({ready});ports[0].close()})
 const update=vi.fn(),register=vi.fn(),getRegistration=vi.fn(async()=>({scope:'https://ticketsv.example/',active:{scriptURL:'https://ticketsv.example/ticketsv-offline-worker.js',postMessage},waiting:waiting?{}:null,update}))
 vi.stubGlobal('location',new URL('https://ticketsv.example/tickets'))
 vi.stubGlobal('navigator',{serviceWorker:{getRegistration,register}})
 return {postMessage,update,register,getRegistration}
}
it('checks existing offline files without registering, updating or fetching',async()=>{
 const r=registration();expect(await attendeeAppStatus(new AbortController().signal)).toBe('ready')
 expect(r.getRegistration).toHaveBeenCalledWith('/');expect(r.postMessage).toHaveBeenCalledTimes(1);expect(r.register).not.toHaveBeenCalled();expect(r.update).not.toHaveBeenCalled()
})
it('does not mark waiting or missing cached files as ready',async()=>{
 const r=registration(true,true);expect(await attendeeAppStatus(new AbortController().signal)).toBe('waiting');expect(r.postMessage).not.toHaveBeenCalled()
 registration(false);expect(await attendeeAppStatus(new AbortController().signal)).toBe('missing')
})
it('rejects cancellation and ignores unrelated worker scopes',async()=>{
 const r=registration(),controller=new AbortController();controller.abort(Error('Cancelled'))
 await expect(attendeeAppStatus(controller.signal)).rejects.toThrow('Cancelled');expect(r.getRegistration).not.toHaveBeenCalled()
 r.getRegistration.mockResolvedValueOnce({scope:'https://ticketsv.example/',active:{scriptURL:'https://ticketsv.example/other-worker.js',postMessage:r.postMessage},waiting:null,update:r.update})
 expect(await attendeeAppStatus(new AbortController().signal)).toBe('missing');expect(r.postMessage).not.toHaveBeenCalled()
})

it('the generated app worker checks every cached asset without downloading files',async()=>{
 const {offlineBuild}=await import('../scripts/offline-build.ts'),{Script}=await import('node:vm')
 const emitted:{fileName:string;source:string}[]=[]
 const plugin=offlineBuild(),hook=plugin.generateBundle as {handler:Function}
 hook.handler.call({emitFile:(asset:{fileName:string;source:string})=>emitted.push(asset)}, {}, {'index.html':{type:'asset',source:'<html></html>'},'assets/main.js':{type:'chunk',code:'// synthetic app'},'assets/brotli.wasm':{type:'asset',source:new Uint8Array([0,97,115,109])}})
 const worker=emitted.find(e=>e.fileName==='ticketsv-offline-worker.js')!
 const listeners=new Map<string,Function>(),postMessage=vi.fn(),downloads=vi.fn();let missing=false,pending:Promise<unknown>|undefined
 new Script(worker.source).runInNewContext({self:{addEventListener:(type:string,handler:Function)=>listeners.set(type,handler)},caches:{open:async()=>({match:async(path:string)=>missing&&path.endsWith('brotli.wasm')?undefined:{},addAll:downloads})}})
 const check=async()=>{listeners.get('message')!({data:'CHECK_APP_CACHE',ports:[{postMessage}],waitUntil:(work:Promise<unknown>)=>{pending=work}});await pending}
 await check();expect(postMessage).toHaveBeenLastCalledWith({ready:true})
 missing=true;await check();expect(postMessage).toHaveBeenLastCalledWith({ready:false});expect(downloads).not.toHaveBeenCalled()
})

// The worker's own decisions, run in a VM with fake caches and network.
async function appWorker(){
 const {offlineBuild}=await import('../scripts/offline-build.ts'),{Script}=await import('node:vm')
 const emitted:{fileName:string;source:string}[]=[]
 const hook=offlineBuild().generateBundle as {handler:Function}
 hook.handler.call({emitFile:(asset:{fileName:string;source:string})=>emitted.push(asset)}, {}, {'index.html':{type:'asset',source:'<html></html>'},'assets/main.js':{type:'chunk',code:'// synthetic app'}})
 const source=emitted.find(e=>e.fileName==='ticketsv-offline-worker.js')!.source,cache=/const CACHE="([^"]+)"/.exec(source)![1]
 const stores=new Map<string,Map<string,unknown>>(),listeners=new Map<string,Function>(),skipWaiting=vi.fn()
 let online=true
 const store=(name:string)=>stores.get(name)??stores.set(name,new Map()).get(name)!
 const caches={keys:async()=>[...stores.keys()],delete:async(name:string)=>stores.delete(name),open:async(name:string)=>{const s=store(name);return {match:async(path:string)=>s.get(path),put:async(path:string,value:unknown)=>{s.set(path,value)},addAll:async(requests:{url:string}[])=>{for(const r of requests)s.set(r.url,'file:'+r.url)}}}}
 const Response=class{body:string;constructor(body:string){this.body=body}async text(){return this.body}static redirect(to:string,status:number){return {redirect:to,status}}}
 const fetch=async(request:{url:string})=>{if(!online)throw TypeError('offline');return 'network:'+new URL(request.url).pathname}
 new Script(source).runInNewContext({self:{location:{origin:'https://ticketsv.example'},skipWaiting,addEventListener:(type:string,handler:Function)=>listeners.set(type,handler)},caches,fetch,Response,URL,Request:class{url:string;constructor(url:string){this.url=url}}})
 const run=async(type:string,event:object)=>{let work:Promise<unknown>|undefined;listeners.get(type)!({...event,waitUntil:(w:Promise<unknown>)=>{work=w}});await work}
 const request=async(path:string,mode='no-cors',method='GET')=>{let answer:Promise<unknown>|undefined;listeners.get('fetch')!({request:{url:'https://ticketsv.example'+path,mode,method},respondWith:(r:Promise<unknown>)=>{answer=r}});return answer&&await answer.catch((e:Error)=>e)}
 return {cache,stores,skipWaiting,run,request,goOffline:()=>{online=false}}
}
it('never answers /api or other sites, serves offline pages from the saved copy and sends unreachable pages to On this device',async()=>{
 const w=await appWorker();await w.run('install',{});await w.run('activate',{})
 expect(await w.request('/api/auth/session')).toBeUndefined()
 expect(await w.request('/offline/tickets','navigate')).toBe('file:/index.html')
 expect(await w.request('/scanner','navigate')).toBe('file:/index.html')
 expect(await w.request('/tickets','navigate')).toBe('network:/tickets')
 w.goOffline()
 expect(await w.request('/api/tickets')).toBeUndefined()
 expect(await w.request('/tickets','navigate')).toEqual({redirect:'/offline/tickets',status:302})
 expect(await w.request('/assets/main.js')).toBe('file:/assets/main.js')
})
it('waits for Reload before updating and keeps the previous version for tabs still on it',async()=>{
 const w=await appWorker();await w.run('install',{});await w.run('activate',{})
 w.stores.set('ticketsv-app-older',new Map([['/assets/older.js','older']]))
 w.stores.set('ticketsv-app-previous',new Map([['/assets/lazy-old.js','old chunk']]))
 w.stores.set('ticketsv-offline-meta',new Map([['/active',{text:async()=>'ticketsv-app-previous'}]]))
 expect(w.skipWaiting).not.toHaveBeenCalled()
 await w.run('message',{data:'SKIP_WAITING',ports:[]});expect(w.skipWaiting).toHaveBeenCalledOnce()
 await w.run('activate',{})
 expect([...w.stores.keys()].filter(n=>n.startsWith('ticketsv-app-')).sort()).toEqual([w.cache,'ticketsv-app-previous'].sort())
 w.goOffline()
 expect(await w.request('/assets/lazy-old.js')).toBe('old chunk')
})
