import {beforeAll,afterAll,describe,it,expect} from 'vitest'
import {IncomingMessage,ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {Pool} from 'pg'
import {PrivateKey,ProtoWallet,type WalletInterface} from '@bsv/sdk'
import {createApp} from '../server/app.ts'
import {migrate} from '../server/database.ts'
import {hashToken} from '../server/auth.ts'
import {verifyScannerPermit} from '../src/scanner/authorization.ts'
import {handoffFixture} from './helpers/handoff-fixture.ts'

describe.skipIf(!process.env.TEST_DATABASE_URL)('received handoff API without network listeners',()=>{
 const serverWallet=new ProtoWallet(PrivateKey.fromRandom()) as WalletInterface
 let pool:Pool,app:ReturnType<typeof createApp>,f:Awaited<ReturnType<typeof handoffFixture>>
 const origin='https://ticketsv.example',tokens=new Map<string,string>()
 beforeAll(async()=>{
  pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:3});await migrate(pool)
  app=createApp({pool,wallet:serverWallet,origins:()=>[origin]})
  f=await handoffFixture(false,'http://localhost:5175')
  for(const owner of [f.ticket.holder,f.source.holder]){const token=crypto.randomUUID().replaceAll('-','').repeat(2);tokens.set(owner,token);await pool.query('INSERT INTO login_sessions VALUES($1,$2,$3,$4,$5)',[hashToken(token),owner,hashToken('cancel-'+token),origin,Date.now()+3600000])}
 })
 afterAll(async()=>{await pool?.end()})
 async function request(path:string,owner?:string,body?:unknown,extra:Record<string,string>={}){
  const req=new IncomingMessage(new Socket()),raw=body===undefined?'':JSON.stringify(body)
  req.method=body===undefined?'GET':'POST';req.url=path;req.headers={host:new URL(origin).host,origin,'content-type':'application/json',...(owner?{cookie:'ticketsv_session='+tokens.get(owner),'x-ticketsv-identity':owner}:{}),...(raw?{'content-length':String(Buffer.byteLength(raw))}:{}),...extra};req.httpVersion='1.1'
  const res=new ServerResponse(req)
  const response=new Promise<{status:number;body:any}>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('In-memory response timed out')),10000),parts:Buffer[]=[]
   res.write=((chunk:unknown)=>{parts.push(Buffer.from(chunk as string));return true}) as typeof res.write
   res.end=((chunk?:unknown)=>{clearTimeout(timer);if(chunk)parts.push(Buffer.from(chunk as string));resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(parts).toString())});res.emit('finish');return res}) as typeof res.end
  })
  app(req,res);req.push(raw?Buffer.from(raw):null);if(raw)req.push(null)
  return response
 }
 it('requires authentication, same-site requests and signed recipient ownership',async()=>{
  expect((await request('/api/tickets/received')).status).toBe(401)
  expect((await request('/api/tickets/received',f.source.holder,{ticket:f.ticket})).status).toBe(400)
  expect((await request('/api/tickets/received',f.ticket.holder,{ticket:f.ticket},{origin:'https://elsewhere.example'})).status).toBe(403)
  expect((await request('/api/tickets/received',f.ticket.holder,{ticket:f.ticket},{'x-ticketsv-identity':f.source.holder})).status).toBe(409)
 })
 it('saves historical evidence once, restores it for its recipient and hides it from other accounts',async()=>{
  const first=await request('/api/tickets/received',f.ticket.holder,{ticket:f.ticket});expect(first.status).toBe(201)
  const retry=await request('/api/tickets/received',f.ticket.holder,{ticket:f.ticket});expect(retry.status).toBe(200);expect(retry.body.id).toBe(first.body.id)
  const list=await request('/api/tickets/received',f.ticket.holder);expect(list.body.tickets).toHaveLength(1);expect(list.body.tickets[0]).not.toHaveProperty('evidence')
  const restored=await request('/api/tickets/received/'+first.body.id,f.ticket.holder);expect(restored.body.ticket).toEqual(f.ticket);expect(restored.body).not.toHaveProperty('verification')
  expect((await request('/api/tickets/received/'+first.body.id,f.source.holder)).status).toBe(404)
  expect((await request('/api/tickets/received',f.source.holder)).body.tickets).toEqual([])
  expect((await pool.query('SELECT count(*) FROM received_ticket_archives')).rows[0].count).toBe('1')
 })
 it('retains old evidence snapshots and rejects changed signed context',async()=>{
  const first=await request('/api/tickets/received',f.ticket.holder,{ticket:f.ticket})
  const changed=await request('/api/tickets/received',f.ticket.holder,{ticket:{...f.ticket,event:{...f.ticket.event,name:'Changed'}}});expect(changed.status).toBe(400)
  expect((await request('/api/tickets/received/'+first.body.id,f.ticket.holder)).body.ticket).toEqual(f.ticket)
  expect((await request('/api/tickets/received?offset=-1',f.ticket.holder)).status).toBe(400)
 })
 it('keeps earlier snapshots when a later wallet report is synchronised, with bounded pagination',async()=>{
  const original=await request('/api/tickets/received',f.ticket.holder,{ticket:f.ticket})
  const reported=await request('/api/tickets/received',f.ticket.holder,{ticket:f.ticket,settlement:{wallet:{state:'absent',checkedAt:new Date().toISOString(),reason:'Reported exact output absent'}}})
  expect(reported.status).toBe(201);expect(reported.body.id).not.toBe(original.body.id)
  const detail=await request('/api/tickets/received/'+original.body.id,f.ticket.holder)
  expect(detail.body).not.toHaveProperty('settlement')
  const first=await request('/api/tickets/received?offset=0',f.ticket.holder)
  expect(first.body.tickets).toHaveLength(2);expect(first.body.nextOffset).toBeNull()
  expect((await request('/api/tickets/received?offset=2',f.ticket.holder)).body.tickets).toEqual([])
  const bad=await request('/api/tickets/received',f.ticket.holder,{ticket:{...f.ticket,request:{...f.request,keySignature:'AAAA'}}})
  expect(bad.status).toBe(400)
 })

 it('issues offline scanner access only for the authenticated wallet and its existing session lifetime',async()=>{
  expect((await request('/api/auth/scanner-permit',undefined,{})).status).toBe(401)
  expect((await request('/api/auth/scanner-permit',f.ticket.holder,{}, {'x-ticketsv-identity':f.source.holder})).status).toBe(409)
  const response=await request('/api/auth/scanner-permit',f.ticket.holder,{})
  expect(response.status).toBe(200)
  const serverIdentity=(await serverWallet.getPublicKey({identityKey:true})).publicKey
  const permit=verifyScannerPermit(response.body,{origin,serverIdentity})
  expect(permit.identityKey).toBe(f.ticket.holder)
  expect(permit.expiresAt-permit.issuedAt).toBeLessThanOrEqual(3600000)
  expect((await request('/api/auth/scanner-permit',f.ticket.holder,{}, {origin:'https://another.example'})).status).toBe(403)
 })

})
