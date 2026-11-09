export type OfflineAppStatus = 'ready' | 'waiting'
export function prepareAttendeeApp(signal:AbortSignal):Promise<OfflineAppStatus>{return prepareCachedApp(signal,{worker:'/attendee-offline-worker.js',scope:'/offline/',message:'PREPARE_ATTENDEE_CACHE'})}
export async function prepareCachedApp(signal: AbortSignal,config:{worker:string;scope:string;message:string}): Promise<OfflineAppStatus> {
 signal.throwIfAborted()
 if (!import.meta.env.PROD) throw Error('Offline app preparation needs the production preview. Run npm run build, then npm run preview -- --port 5175 on this same address.')
 if (!window.isSecureContext || !('serviceWorker' in navigator)) throw Error('This browser needs HTTPS or localhost and service worker support to save the app.')
 let registration: ServiceWorkerRegistration
 try {
  registration = await navigator.serviceWorker.register(config.worker, { scope: config.scope, updateViaCache: 'none' })
  signal.throwIfAborted()
  await registration.update()
 } catch {
  signal.throwIfAborted()
  throw Error('App files could not be saved. Stay online and try saving again.')
 }
 signal.throwIfAborted()
 const installing = registration.installing
 if (installing) await new Promise<void>((resolve, reject) => {
  const cleanup = () => { clearTimeout(timer); installing.removeEventListener('statechange', changed); signal.removeEventListener('abort', aborted) }
  const aborted = () => { cleanup(); reject(signal.reason) }
  const changed = () => {
   if (installing.state === 'activated' || (installing.state === 'installed' && registration.waiting && registration.active)) { cleanup(); resolve() }
   if (installing.state === 'redundant') { cleanup(); reject(Error('App files could not be saved. Stay online and try saving again.')) }
  }
  const timer = setTimeout(() => { cleanup(); reject(Error('App preparation timed out. Stay online and try saving again.')) }, 60000)
  installing.addEventListener('statechange', changed); signal.addEventListener('abort', aborted, { once: true }); changed()
 })
 signal.throwIfAborted()
 const target = registration.waiting ?? registration.active
 if (!target) throw Error('The offline app is not active yet. Stay online and try saving again.')
 await new Promise<void>((resolve, reject) => {
  const channel = new MessageChannel()
  const cleanup = () => { clearTimeout(timer); channel.port1.close(); signal.removeEventListener('abort', aborted) }
  const aborted = () => { cleanup(); reject(signal.reason) }
  const timer = setTimeout(() => { cleanup(); reject(Error('Could not confirm saved app files. Stay online and try again.')) }, 60000)
  channel.port1.onmessage = event => { cleanup(); event.data?.ready === true ? resolve() : reject(Error('App files could not be saved. Stay online and try saving again.')) }
  signal.addEventListener('abort', aborted, { once: true })
  try { target.postMessage(config.message, [channel.port2]) } catch (error) { cleanup(); reject(error) }
 })
 signal.throwIfAborted()
 return registration.waiting ? 'waiting' : 'ready'
}
