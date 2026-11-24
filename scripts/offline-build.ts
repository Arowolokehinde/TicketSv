import { createHash } from 'node:crypto'
import type { Plugin } from 'vite'

// Narrow diagnostic scope. No runtime API cache, takeover or update messages.
export function offlineBuild(): Plugin {
  return {
    name: 'counterfoil-offline-reopening',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const files = Object.keys(bundle)
          .filter(name => name === 'index.html' || name.startsWith('assets/'))
          .sort()
        if (!files.includes('index.html')) throw new Error('Offline build is missing its HTML shell')
        const version = createHash('sha256')
        for (const name of files) {
          const entry = bundle[name]
          version.update(name)
          version.update(entry.type === 'chunk' ? entry.code : entry.source)
        }
        for (const config of [
          { file: 'offline-worker.js', prefix: 'counterfoil-reopening-', path: '/dev/reopening', message: 'PREPARE_REOPENING_CACHE' },
        ]) {
          // Only the attendee and scanner workers answer a cache check or serve extra pages.
          const cacheCheck =
            config.file === 'offline-worker.js'
              ? ''
              : `if(event.data===${JSON.stringify(config.file === 'scanner-offline-worker.js' ? 'CHECK_SCANNER_CACHE' : 'CHECK_ATTENDEE_CACHE')}` +
                `&&event.ports[0]){event.waitUntil((async()=>{const cache=await caches.open(CACHE),` +
                `found=await Promise.all(FILES.map(path=>cache.match(path)));event.ports[0].postMessage({ready:found.every(Boolean)});})());return;}`
          const extraPages =
            config.file === 'attendee-offline-worker.js'
              ? ['/offline/handoff', '/offline/handoff/']
              : config.file === 'scanner-offline-worker.js'
                ? ['/scanner/prepare', '/scanner/prepare/']
                : []
          const source = `
const CACHE=__TICKETSV_CACHE__;
const FILES=${JSON.stringify(files.map(f => '/' + f))};
self.addEventListener('install',event=>event.waitUntil((async()=>{
 try { const cache=await caches.open(CACHE); await cache.addAll(FILES.map(path=>new Request(path,{cache:'reload'}))); }
 catch(error){ await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('message',event=>{
 ${cacheCheck}
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
 const navigation=request.mode==='navigate'&&${JSON.stringify([config.path, config.path + '/', ...extraPages])}.includes(url.pathname);
 if(!navigation&&(!FILES.includes(url.pathname)||url.search))return;
 event.respondWith((async()=>{
  const cached=await (await caches.open(CACHE)).match(navigation?'/index.html':url.pathname);
  return cached||new Response('Offline app files missing. Reconnect and prepare again.',{status:503,headers:{'Content-Type':'text/plain'}});
 })());
});`
          const cache = config.prefix + version.copy().update(source).digest('hex').slice(0, 20)
          this.emitFile({ type: 'asset', fileName: config.file, source: source.replace('__TICKETSV_CACHE__', JSON.stringify(cache)) })
        }
        const app = appWorker(files)
        this.emitFile({
          type: 'asset',
          fileName: 'ticketsv-offline-worker.js',
          source: app.replace(
            '__TICKETSV_CACHE__',
            JSON.stringify('ticketsv-app-' + version.copy().update(app).digest('hex').slice(0, 20)),
          ),
        })
        // The earlier per-page workers, replaced by one that clears its own cache and
        // unregisters the next time the browser checks it for an update online.
        for (const [file, prefix] of [
          ['attendee-offline-worker.js', 'ticketsv-attendee-app-'],
          ['scanner-offline-worker.js', 'ticketsv-scanner-app-'],
        ])
          this.emitFile({
            type: 'asset',
            fileName: file,
            source: `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(${JSON.stringify(prefix)}))await caches.delete(name);
 await self.registration.unregister();
})()));`,
          })
      },
    },
  }
}

// TicketSV's one offline worker, at scope /. It saves the app files on any
// online visit; serves the offline pages from that saved copy; answers other
// pages from the network, sending an unreachable one to On this device; and
// never touches /api or other sites. A new version waits until the person
// selects Reload, and the previous version's files stay for tabs still on it.
export const OFFLINE_PAGES = ['/offline/tickets', '/offline/handoff', '/scanner', '/scanner/prepare']
export function appWorker(files: string[]): string {
  return `
const CACHE=__TICKETSV_CACHE__,PREFIX='ticketsv-app-',META='ticketsv-offline-meta';
const FILES=${JSON.stringify(files.map(f => '/' + f))};
const PAGES=${JSON.stringify(OFFLINE_PAGES.flatMap(p => [p, p + '/']))};
self.addEventListener('install',event=>event.waitUntil((async()=>{
 try { const cache=await caches.open(CACHE); await cache.addAll(FILES.map(path=>new Request(path,{cache:'reload'}))); }
 catch(error){ await caches.delete(CACHE); throw error; }
})()));
async function complete(){const cache=await caches.open(CACHE);return (await Promise.all(FILES.map(path=>cache.match(path)))).every(Boolean)}
self.addEventListener('message',event=>{
 if(event.data==='SKIP_WAITING'){self.skipWaiting();return}
 const port=event.ports[0];if(!port)return;
 if(event.data==='CHECK_APP_CACHE'){event.waitUntil(complete().then(ready=>port.postMessage({ready}),()=>port.postMessage({ready:false})));return}
 if(event.data!=='PREPARE_APP_CACHE')return;
 event.waitUntil((async()=>{
  try {
   const cache=await caches.open(CACHE),missing=[];
   for(const path of FILES)if(!await cache.match(path))missing.push(new Request(path,{cache:'reload'}));
   if(missing.length)await cache.addAll(missing);
   port.postMessage({ready:true});
  }catch{port.postMessage({ready:false});}
 })());
});
// Keep this version and the one active before it; older versions go.
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const meta=await caches.open(META),saved=await meta.match('/active'),previous=saved?await saved.text():'';
 for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE&&name!==previous)await caches.delete(name);
 if(previous!==CACHE)await meta.put('/active',new Response(CACHE));
})()));
async function saved(path){
 const hit=await (await caches.open(CACHE)).match(path);if(hit)return hit;
 for(const name of await caches.keys())if(name.startsWith(PREFIX)){const old=await (await caches.open(name)).match(path);if(old)return old}
}
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  if(PAGES.includes(url.pathname))event.respondWith((async()=>(await (await caches.open(CACHE)).match('/index.html'))||fetch(request))());
  else event.respondWith(fetch(request).catch(async()=>{
   if(await (await caches.open(CACHE)).match('/index.html'))return Response.redirect('/offline/tickets',302);
   throw Error('Offline and no saved app');
  }));
  return;
 }
 if(url.search||!(FILES.includes(url.pathname)||url.pathname.startsWith('/assets/')))return;
 event.respondWith((async()=>(await saved(url.pathname))||fetch(request))());
});`
}
