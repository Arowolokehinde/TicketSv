import type {IncomingMessage,ServerResponse} from 'node:http'
import {Pool} from 'pg'
import {ProtoWallet,type WalletInterface} from '@bsv/sdk'
import {attachDatabasePool,waitUntil} from '@vercel/functions'
import {createApp} from '../server/app.ts'
import {hostedConfig} from '../server/hosted-config.ts'
import {PostgresSessionManager} from '../server/hosted-sessions.ts'
import {hostedHeaderResumer} from '../server/hosted-headers.ts'

let runtime:Promise<ReturnType<typeof createApp>>|undefined
function initialize(){
 return (async()=>{
  const config=hostedConfig(process.env)
  const pool=new Pool({connectionString:config.connectionString,max:4,connectionTimeoutMillis:8000,idleTimeoutMillis:5000,statement_timeout:10_000})
  pool.on('error',()=>console.error('Hosted PostgreSQL idle connection failed'))
  attachDatabasePool(pool)
  try{
   if(!(await pool.query('SELECT 1 FROM ticketsv_migrations WHERE version=8')).rowCount)throw Error('Apply TicketSV migration 008 before deployment')
   return createApp({pool,wallet:new ProtoWallet(config.key) as WalletInterface,origins:()=>config.origins,
    sessionManager:new PostgresSessionManager(pool),resumeHeaders:hostedHeaderResumer(pool,waitUntil)})
  }catch(error){await pool.end();throw error}
 })()
}
export default async function handler(req:IncomingMessage,res:ServerResponse){
 if((req.url??'').split('?')[0]==='/api/auth/login'){
  // Shape only: never log request bodies, cookies, nonce/signature/key values.
  const url=new URL(req.url!,'https://ticketsv.invalid')
  console.info('TicketSV authentication request shape',{
   path:url.pathname,queryKeys:[...url.searchParams.keys()].slice(0,8),
   signedHeaderNames:Object.keys(req.headers).filter(name=>name==='content-type'||name==='authorization'||name.startsWith('x-bsv-')&&!name.startsWith('x-bsv-auth')).sort(),
   hasSignature:typeof req.headers['x-bsv-auth-signature']==='string',bodyType:typeof (req as IncomingMessage&{body?:unknown}).body,
  })
 }
 let app:ReturnType<typeof createApp>
 try{app=await(runtime??=initialize())}catch(error){
  runtime=undefined
  console.error('TicketSV hosted startup failed:',error instanceof Error?error.message:'configuration unavailable')
  res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'TicketSV API is not ready. Please try again shortly.'}));return
 }
 app(req,res)
}
