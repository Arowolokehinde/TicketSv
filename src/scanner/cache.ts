import {prepareCachedApp} from '../offline/attendee-cache.ts'
export const prepareScannerApp=(signal:AbortSignal)=>prepareCachedApp(signal,{worker:'/scanner-offline-worker.js',scope:'/scanner',message:'PREPARE_SCANNER_CACHE'})
export async function scannerCacheStatus():Promise<'ready'|'waiting'|'reload'|'missing'>{
 if(!('serviceWorker' in navigator))return 'missing'
 const registration=await navigator.serviceWorker.getRegistration('/scanner')
 if(registration?.waiting)return 'waiting'
 if(!registration?.active)return 'missing'
 const ready=await new Promise<boolean>(resolve=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(false)},3000)
  channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.ready===true)}
  try{registration.active!.postMessage('CHECK_SCANNER_CACHE',[channel.port2])}catch{clearTimeout(timer);channel.port1.close();resolve(false)}
 })
 if(!ready)return 'missing'
 return navigator.serviceWorker.controller?.scriptURL.endsWith('/scanner-offline-worker.js')?'ready':'reload'
}
