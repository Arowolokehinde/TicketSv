import {attendeeAppStatus,type OfflineAppStatus} from './attendee-cache.ts'
export type BrowserCompatibility={secureContext:boolean;serviceWorkers:boolean;cacheAPI:boolean;localDatabase:boolean;nativeWalletBridge:boolean;appFiles:OfflineAppStatus|'missing'|'unavailable'}
// Feature detection plus the existing worker's read-only asset check. This never
// registers workers, downloads app files, reads keys, or calls a wallet method.
export async function readBrowserCompatibility(signal:AbortSignal):Promise<BrowserCompatibility>{
 signal.throwIfAborted()
 const serviceWorkers=typeof navigator.serviceWorker?.register==='function'
 let appFiles:BrowserCompatibility['appFiles']='missing'
 if(serviceWorkers)try{appFiles=await attendeeAppStatus(signal)}catch{signal.throwIfAborted();appFiles='unavailable'}
 return {secureContext:window.isSecureContext,serviceWorkers,cacheAPI:typeof caches!=='undefined',localDatabase:typeof indexedDB!=='undefined',nativeWalletBridge:typeof (window as unknown as {ReactNativeWebView?:{postMessage?:unknown}}).ReactNativeWebView?.postMessage==='function',appFiles}
}
