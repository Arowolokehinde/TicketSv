// Opt-in local API lifecycle task, not an installed daemon. Hosted functions use
// the bounded cron endpoint instead. Optional discovery is paced separately;
// blocked history is never collected automatically.
export function startHeaderCollector(
 read:()=>Promise<{state:string}>, collect:(signal:AbortSignal)=>Promise<unknown>, warn:(error:unknown)=>void=console.error, prefetch?:(signal:AbortSignal)=>Promise<void>,
):()=>Promise<void>{
 const controller=new AbortController()
 let nextPrefetch=0
 let timer:ReturnType<typeof setTimeout>|undefined,running:Promise<void>|undefined
 const run=async()=>{
  try {
   if(prefetch&&Date.now()>=nextPrefetch&&!controller.signal.aborted){
    nextPrefetch=Date.now()+60_000
    try{await prefetch(controller.signal)}catch(error){if(!controller.signal.aborted)warn(error)}
   }
   const status=await read()
   if(!controller.signal.aborted&&['queued','collecting','retrying'].includes(status.state))await collect(controller.signal)
  }catch(e){if(!controller.signal.aborted)warn(e)}
  finally{if(!controller.signal.aborted)timer=setTimeout(start,2000)}
 }
 const start=()=>{running=run()}
 start()
 return async()=>{controller.abort(Error('Local header collector stopped. Saved progress retained.'));clearTimeout(timer);await running}
}
