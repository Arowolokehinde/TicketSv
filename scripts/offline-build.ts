import {createHash} from 'node:crypto'
import type {Plugin} from 'vite'

// Narrow diagnostic scope. No runtime API cache, takeover or update messages.
export function offlineBuild():Plugin{
 return {name:'counterfoil-offline-reopening',apply:'build',generateBundle:{order:'post',handler(_options,bundle){
  const files=Object.keys(bundle).filter(name=>name==='index.html'||name.startsWith('assets/')).sort()
  if(!files.includes('index.html'))throw new Error('Offline build is missing its HTML shell')
  const version=createHash('sha256')
  for(const name of files){const entry=bundle[name];version.update(name);version.update(entry.type==='chunk'?entry.code:entry.source)}
  for (const config of [
   { file: 'offline-worker.js', prefix: 'counterfoil-reopening-', path: '/dev/reopening', message: 'PREPARE_REOPENING_CACHE' },
   { file: 'attendee-offline-worker.js', prefix: 'ticketsv-attendee-app-', path: '/offline/tickets', message: 'PREPARE_ATTENDEE_CACHE' },
   { file: 'scanner-offline-worker.js', prefix: 'ticketsv-scanner-app-', path: '/scanner', message: 'PREPARE_SCANNER_CACHE' },
  ]) {
  const source=`
const CACHE=__COUNTERFOIL_CACHE__;
const FILES=${JSON.stringify(files.map(f=>'/'+f))};
self.addEventListener('install',event=>event.waitUntil((async()=>{
 try { const cache=await caches.open(CACHE); await cache.addAll(FILES.map(path=>new Request(path,{cache:'reload'}))); }
 catch(error){ await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('message',event=>{
 ${config.file==='scanner-offline-worker.js'?`if(event.data==='CHECK_SCANNER_CACHE'&&event.ports[0]){event.waitUntil((async()=>{const cache=await caches.open(CACHE),found=await Promise.all(FILES.map(path=>cache.match(path)));event.ports[0].postMessage({ready:found.every(Boolean)});})());return;}`:''}
 if(event.data!==${JSON.stringify(config.message)}||!event.ports[0])return;
 event.waitUntil((async()=>{
  try {
   const cache=await caches.open(CACHE),missing=[];
   for(const path of FILES)if(!await cache.match(path))missing.push(new Request(path,{cache:'reload'}));
   if(missing.length)await cache.addAll(missing);
   event.ports[0].postMessage({ready:true});
  }catch{event.ports[0].postMessage({ready:false});}
 })());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(${JSON.stringify(config.prefix)})&&name!==CACHE)await caches.delete(name);
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 const navigation=request.mode==='navigate'&&${JSON.stringify([config.path,config.path+'/',...(config.file==='attendee-offline-worker.js'?['/offline/handoff','/offline/handoff/']:config.file==='scanner-offline-worker.js'?['/scanner/prepare','/scanner/prepare/']:[])])}.includes(url.pathname);
 if(!navigation&&(!FILES.includes(url.pathname)||url.search))return;
 event.respondWith((async()=>{
  const cached=await (await caches.open(CACHE)).match(navigation?'/index.html':url.pathname);
  return cached||new Response('Offline app files missing. Reconnect and prepare again.',{status:503,headers:{'Content-Type':'text/plain'}});
 })());
});`
  const cache=config.prefix+version.copy().update(source).digest('hex').slice(0,20)
  this.emitFile({type:'asset',fileName:config.file,source:source.replace('__COUNTERFOIL_CACHE__',JSON.stringify(cache))})
  }
 }}}
}
