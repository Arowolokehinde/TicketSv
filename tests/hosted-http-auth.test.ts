import {beforeAll,afterAll,describe,it,expect} from 'vitest'
import {IncomingMessage,ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {readFileSync} from 'node:fs'
import {Pool} from 'pg'
import {AuthFetch,PrivateKey,ProtoWallet,type WalletInterface} from '@bsv/sdk'
import {createApp} from '../server/app.ts'
import {PostgresSessionManager} from '../server/hosted-sessions.ts'
import {migrate} from '../server/database.ts'

// Model the routing behavior observed in production: unused named wildcard
// captures are appended to the function URL's query. Exact rewrites do not add
// captures. Do not strip request queries in application authentication code.
function routedUrl(url:URL){
 const config=JSON.parse(readFileSync('vercel.json','utf8')) as {rewrites:{source:string;destination:string}[]}
 const rule=config.rewrites.find(r=>r.source===url.pathname||r.source==='/api/:path*'&&url.pathname.startsWith('/api/'))
 if(!rule)throw Error('No configured API rewrite')
 const routed=new URL(url)
 if(rule.source==='/api/:path*')routed.searchParams.append('path',url.pathname.slice('/api/'.length))
 return routed.pathname+routed.search
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('hosted HTTP wallet authentication without network listeners',()=>{
 let pool:Pool
 const origin='https://ticketsv.example',serverWallet=new ProtoWallet(PrivateKey.fromRandom()) as WalletInterface
 beforeAll(async()=>{pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});await migrate(pool)})
 afterAll(async()=>{await pool?.end()})
 function client(route:(url:URL)=>string){
  const cookies=new Map<string,string>(),wallet=new ProtoWallet(PrivateKey.fromRandom()) as WalletInterface
  const transport:typeof fetch=async(input,init)=>{
   const url=new URL(input instanceof Request?input.url:String(input)),headers=new Headers(init?.headers)
   headers.set('host',url.host);headers.set('origin',origin);headers.set('cookie',[...cookies].map(([k,v])=>`${k}=${v}`).join('; '))
   const body=typeof init?.body==='string'?init.body:''
   if(body)headers.set('content-length',String(Buffer.byteLength(body)))
   const req=new IncomingMessage(new Socket())
   req.method=init?.method??'GET';req.url=route(url);req.headers=Object.fromEntries(headers);req.httpVersion='1.1';req.httpVersionMajor=1;req.httpVersionMinor=1
   const res=new ServerResponse(req)
   // Response stream in memory: no bound socket, HTTP server or wallet service.
   const response=new Promise<Response>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('In-memory HTTP response timed out')),5000)
    const parts:Buffer[]=[]
    res.write=((chunk:unknown)=>{parts.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk)));return true}) as typeof res.write
    res.end=((chunk?:unknown)=>{
     clearTimeout(timer)
     if(chunk!==undefined&&chunk!==null)parts.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk)))
     const resultHeaders=new Headers()
     for(const [name,value] of Object.entries(res.getHeaders())){
      for(const v of Array.isArray(value)?value:[value])if(v!==undefined)resultHeaders.append(name,String(v))
     }
     for(const item of resultHeaders.getSetCookie()){const [key,value]=item.split(';')[0].split('=');cookies.set(key,value)}
     resolve(new Response(Buffer.concat(parts),{status:res.statusCode,headers:resultHeaders}));res.emit('finish');return res
    }) as typeof res.end
   })
   const app=createApp({pool,wallet:serverWallet,origins:()=>[origin],sessionManager:new PostgresSessionManager(pool)})
   app(req,res);req.push(body?Buffer.from(body):null);if(body)req.push(null)
   return response
  }
  const login=async()=>{
   const challenge=await transport(origin+'/api/auth/challenge',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json())
   const auth=new AuthFetch(wallet,undefined,undefined,undefined,{},transport)
   return auth.fetch(origin+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(challenge)})
  }
  return {login}
 }
 it('authenticates the HTTP login across fresh instances with unchanged signed paths',async()=>{
  expect((await client(url=>url.pathname+url.search).login()).status).toBe(200)
 })
 it('preserves the signed login URL through the configured production rewrite',async()=>{
  expect((await client(routedUrl).login()).status).toBe(200)
 })
 it('rejects an added unsigned query parameter instead of ignoring signed URL changes',async()=>{
  await expect(client(url=>url.pathname+url.search+(url.pathname==='/api/auth/login'?'?unexpected=1':'')).login()).rejects.toThrow(/401|auth/i)
 })
})
