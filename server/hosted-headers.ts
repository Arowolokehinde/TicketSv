import type {Pool} from 'pg'
import {collectHeadersTick} from './header-cache.ts'

export function hostedHeaderResumer(pool:Pool,waitUntil:(task:Promise<unknown>)=>void,collect=collectHeadersTick):()=>void{
 let active:Promise<void>|undefined
 return ()=>{
  if(active)return
  active=(async()=>{
   const signal=AbortSignal.timeout(35_000)
   let previous:number|null|undefined
   // One request buys finite shared work. Database collector locking coalesces
   // across instances. A subsequent authenticated poll can resume more work.
   for(let tick=0;tick<8&&!signal.aborted;tick++){
    const state=await collect(pool,signal)
    if(['blocked','retrying'].includes(state.state)||state.tip!==null&&state.tip>=state.target||state.tip===previous)break
    previous=state.tip
   }
  })().catch(error=>{console.warn('Hosted header preparation:',error instanceof Error?error.message:'operation failed')}).finally(()=>{active=undefined})
  waitUntil(active)
 }
}
