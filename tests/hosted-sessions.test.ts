import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {Pool} from 'pg'
import {migrate} from '../server/database.ts'
import {PostgresSessionManager} from '../server/hosted-sessions.ts'
import {Peer,PrivateKey,ProtoWallet,type AuthMessage,type WalletInterface} from '@bsv/sdk'

describe.skipIf(!process.env.TEST_DATABASE_URL)('shared hosted authentication sessions',()=>{
 let pool:Pool, now:number
 beforeAll(async()=>{pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:4});await migrate(pool)})
 afterAll(async()=>{await pool?.end()})
 beforeEach(async()=>{now=1_000_000;await pool.query('TRUNCATE auth_peer_sessions CASCADE');await pool.query('TRUNCATE auth_initial_nonces')})
 const session=(nonce='session',authenticated=false)=>({sessionNonce:nonce,peerIdentityKey:'identity',peerNonce:'peer',isAuthenticated:authenticated,lastUpdate:now,certificatePolicy:{certifiers:['issuer'],types:{type:['field']}}})
 const manager=(options={})=>new PostgresSessionManager(pool,{now:()=>now,...options})
 it('continues an authenticated session on a fresh instance and retains local certificate policy',async()=>{
  const a=manager(),b=manager();await a.addSession(session())
  await b.updateSession({...session(),...(await b.getSession('session')),isAuthenticated:true,certificatesRequired:true,certificatesValidated:true})
  expect(await manager().getSession('identity')).toMatchObject({...session(),isAuthenticated:true,certificatesRequired:true,certificatesValidated:true})
  expect(await a.hasSession('session')).toBe(true)
 })
 it('claims a signed nonce exactly once across concurrent instances and retains claims on session update',async()=>{
  await manager().addSession(session())
  const results=await Promise.all(Array.from({length:8},()=>manager().claimMessageNonce('session','message')))
  expect(results.filter(Boolean)).toHaveLength(1)
  await manager().updateSession({...session(),isAuthenticated:true})
  expect(await manager().claimMessageNonce('session','message')).toBe(false)
 })
 it('claims initial nonces once per identity across instances',async()=>{
  const results=await Promise.all(Array.from({length:6},()=>manager().claimInitialRequestNonce('identity','initial')))
  expect(results.filter(Boolean)).toHaveLength(1)
  expect(await manager().claimInitialRequestNonce('other','initial')).toBe(true)
 })
 it('expires sessions and replay claims and rejects claims for missing sessions',async()=>{
  await manager().addSession(session());await manager().claimInitialRequestNonce('identity','initial')
  now+=300_000
  expect(await manager().getSession('session')).toBeUndefined()
  await expect(manager().claimMessageNonce('session','message')).rejects.toThrow(/session/i)
  expect(await manager().claimInitialRequestNonce('identity','initial')).toBe(true)
  await expect(manager().addSession({...session(),lastUpdate:now-300_000})).rejects.toThrow(/expired/i)
 })
 it('bounds sessions and signed claims without discarding authenticated sessions or replay history',async()=>{
  const m=manager({maxSessions:1,maxMessageNonces:1})
  await m.addSession(session('a',true))
  await expect(m.addSession(session('b'))).rejects.toThrow(/capacity/i)
  expect(await m.getSession('a')).toMatchObject({isAuthenticated:true})
  await m.claimMessageNonce('a','one');await expect(m.claimMessageNonce('a','two')).rejects.toThrow(/capacity/i)
  expect(await m.claimMessageNonce('a','one')).toBe(false)
 })
 it('removes session claims with the session and prefers authenticated identity sessions',async()=>{
  await manager().addSession(session('a',true));now++
  await manager().addSession(session('b'));expect((await manager().getSession('identity'))?.sessionNonce).toBe('a')
  await manager().claimMessageNonce('a','message');await manager().removeSession(session('a'))
  expect(await manager().hasSession('a')).toBe(false)
  expect((await pool.query('SELECT * FROM auth_message_nonces')).rowCount).toBe(0)
 })
 it('authenticates real SDK messages when each server message reaches a fresh peer instance',async()=>{
  const serverWallet=new ProtoWallet(PrivateKey.fromRandom()),clientWallet=new ProtoWallet(PrivateKey.fromRandom())
  const identity=(await serverWallet.getPublicKey({identityKey:true})).publicKey
  let clientReceive!:(message:AuthMessage)=>Promise<void>
  const received:number[][]=[]
  const client=new Peer(clientWallet as WalletInterface,{
   onData:async callback=>{clientReceive=callback},
   send:async message=>{
    let serverReceive!:(message:AuthMessage)=>Promise<void>
    const peer=new Peer(serverWallet as WalletInterface,{onData:async callback=>{serverReceive=callback},send:async response=>{await clientReceive(response)}},undefined,manager({now:Date.now}))
    peer.listenForGeneralMessages((_sender,payload)=>{received.push(payload)})
    await peer.ready;await serverReceive(message)
   },
  })
  await client.ready
  await client.toPeer([1,2,3],identity)
  await client.toPeer([4,5,6],identity)
  expect(received).toEqual([[1,2,3],[4,5,6]])
 })
})
