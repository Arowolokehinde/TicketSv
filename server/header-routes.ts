import type { Express } from 'express'
import type { Pool } from 'pg'
import {prefetchHeaderTarget} from './header-prefetch.ts'
import { timingSafeEqual } from 'node:crypto'
import { cachedHeaderRange, collectHeadersTick, queueHeaders, readHeaderProgress } from './header-cache.ts'
import {sessionFor} from './auth.ts'
export function headerRoutes(app:Express,pool:Pool,resume?:()=>void){
 app.post('/api/tickets/header-preparation',async(req,res)=>{
  const progress=await queueHeaders(pool,req.body?.height)
  res.status(202).json(progress)
  if(progress.state!=='blocked'&&(progress.tip===null||progress.tip<progress.target))resume?.()
 })
 app.get('/api/headers/status',async(req,res)=>{
  const progress=await readHeaderProgress(pool)
  // Anonymous status reads remain cheap and never start collection.
  const allowed=resume&&progress.state!=='blocked'&&(progress.tip===null||progress.tip<progress.target)&&await sessionFor(pool,req,res.locals.origin,Date.now())
  res.json(progress)
  if(allowed)resume?.()
 })
 app.get('/api/headers/range',async(req,res)=>{
  const start=Number(req.query.start),count=Number(req.query.count)
  const batch=await cachedHeaderRange(pool,start,count)
  res.set({'Content-Type':'application/octet-stream','X-TicketSV-Header-Start':String(start),'X-TicketSV-Header-Count':String(batch.count),'X-TicketSV-Header-Network':'testnet','X-TicketSV-Header-Checkpoint':batch.state.checkpoint.hash,'X-TicketSV-Header-Comparison':'server-reported'})
  res.send(Buffer.from(batch.bytes))
 })
 // Suitable for a protected scheduled invocation, never called by attendees.
 app.get('/api/internal/headers/collect',async(req,res)=>{
  const secret=process.env.HEADER_COLLECTOR_SECRET??process.env.CRON_SECRET,provided=Buffer.from(req.headers.authorization??'')
  const expected=Buffer.from(`Bearer ${secret??''}`)
  if(!secret||secret.length<32||provided.length!==expected.length||!timingSafeEqual(provided,expected)){res.status(401).json({error:'Collector authorization required.'});return}
  const signal=AbortSignal.timeout(35_000)
  if(process.env.HEADER_PREFETCH!=='0')try{await prefetchHeaderTarget(pool,signal)}catch(error){console.warn('Header prefetch:',error instanceof Error?error.message:'operation failed')}
  res.json(await collectHeadersTick(pool,signal))
 })
}
