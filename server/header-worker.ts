import { existsSync } from 'node:fs'
import { Pool } from 'pg'
import { collectHeadersTick, queueHeaders, readHeaderCache, reviewBlockedHeaders } from './header-cache.ts'
if(existsSync('.env'))process.loadEnvFile('.env')
if(!process.env.DATABASE_URL)throw Error('Configure the TicketSV DATABASE_URL first.')
const args=process.argv.slice(2),warm=args[0]==='--warm',once=args.length===0||args[0]==='--once',review=args[0]==='--review-blocked'
if(!warm&&!once&&!review||warm&&(args.length!==2||!/^\d+$/.test(args[1]))||!warm&&args.length>1)throw Error('Usage: npm run headers:collect -- [--once | --warm HEIGHT | --review-blocked]')
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000,statement_timeout:10000})
const controller=new AbortController()
for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>controller.abort(Error('Header warm-up cancelled. Saved prefix retained.')))
try{
 if(review){console.log(JSON.stringify(await reviewBlockedHeaders(pool,controller.signal)))}
 if(warm)await queueHeaders(pool,Number(args[1]))
 // Finite warm-up only, at most the entire existing experiment range. No daemon.
 for(let tick=0;tick<(review?0:warm?10:1);tick++){
  controller.signal.throwIfAborted()
  const state=await collectHeadersTick(pool,controller.signal)
  console.log(JSON.stringify(state))
  if(['blocked','retrying'].includes(state.state)){process.exitCode=1;break}
  if(state.tip!==null&&state.tip>=state.target)break
  if(state.state==='collecting'){console.log('Another collector is active.');break}
 }
 const final=await readHeaderCache(pool)
 if(warm&&(final.tip===null||final.tip<Number(args[1])))process.exitCode=1
}finally{await pool.end()}
