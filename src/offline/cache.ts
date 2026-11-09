export async function prepareOfflineApp():Promise<string>{
 if(!import.meta.env.PROD)throw new Error('Use the production preview on the same browser origin; the development server is not cached.')
 if(!window.isSecureContext||!('serviceWorker' in navigator))throw new Error('Offline reopening requires a secure context and service worker support.')
 const registration=await navigator.serviceWorker.register('/offline-worker.js',{scope:'/dev/reopening',updateViaCache:'none'})
 // No update takeover: the browser may also check for updates on navigation.
 await registration.update()
 const worker=registration.installing
 if(worker)await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(new Error('App cache preparation timed out; keep online and prepare again.'))},60000)
  const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('statechange',changed)}
  const changed=()=>{
   if(worker.state==='installed'||worker.state==='activated'){cleanup();resolve()}
   if(worker.state==='redundant'){cleanup();reject(new Error('App files could not be cached; keep online and prepare again.'))}
  }
  worker.addEventListener('statechange',changed);changed()
 })
 const target=registration.waiting??registration.active
 if(!target)throw new Error('Offline worker is not active yet. Keep online and prepare again.')
 // An active registration alone does not prove its cache survived eviction.
 await new Promise<void>((resolve,reject)=>{
  const channel=new MessageChannel()
  const cleanup=()=>{clearTimeout(timer);channel.port1.close()}
  const timer=setTimeout(()=>{cleanup();reject(new Error('App cache confirmation timed out; keep online and prepare again.'))},60000)
  channel.port1.onmessage=event=>{cleanup();if(event.data?.ready===true)resolve();else reject(new Error('App files could not be cached; keep online and prepare again.'))}
  target.postMessage('PREPARE_REOPENING_CACHE',[channel.port2])
 })
 if(registration.waiting)return 'New app files saved. Close all reopening tabs and reopen this address while online to activate the update.'
 if(!registration.active)throw new Error('Offline worker is not active yet. Keep online and prepare again.')
 return 'App files saved. Reload this page once while online, then verify the saved transfer before disconnecting.'
}
