import type {AsyncSessionManager, PeerSession} from '@bsv/sdk'
import type {Pool, PoolClient} from 'pg'
import {CHALLENGE_MS} from './auth.ts'

type Options={now?:()=>number;maxSessions?:number;maxMessageNonces?:number;maxInitialNonces?:number}
// All writes use a transaction-scoped lock, including capacity checks and replay
// claims. This works across function instances and with transaction poolers.
// Nonce rows survive session updates and disappear only when that session ends.
export class PostgresSessionManager implements AsyncSessionManager {
 private readonly pool:Pool
 private readonly now:()=>number
 private readonly maxSessions:number
 private readonly maxMessageNonces:number
 private readonly maxInitialNonces:number
 constructor(pool:Pool,options:Options={}){
  this.pool=pool;this.now=options.now??Date.now
  this.maxSessions=options.maxSessions??1000;this.maxMessageNonces=options.maxMessageNonces??100;this.maxInitialNonces=options.maxInitialNonces??2000
  for(const limit of [this.maxSessions,this.maxMessageNonces,this.maxInitialNonces])if(!Number.isSafeInteger(limit)||limit<1)throw Error('Invalid session storage capacity')
 }
 private time(){const n=this.now();if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid session clock');return n}
 private text(value:unknown){if(typeof value!=='string'||!value.length||value.length>512||value.includes('\0'))throw Error('Invalid session identifier');return value}
 private async write<T>(operation:(db:PoolClient,now:number)=>Promise<T>):Promise<T>{
  const db=await this.pool.connect()
  try{
   await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(84723521)')
   const now=this.time()
   await db.query('DELETE FROM auth_peer_sessions WHERE expires_at<=$1',[now])
   await db.query('DELETE FROM auth_initial_nonces WHERE claimed_at<=$1',[now-CHALLENGE_MS])
   const result=await operation(db,now);await db.query('COMMIT');return result
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 }
 async addSession(session:PeerSession):Promise<void>{
  const nonce=this.text(session.sessionNonce)
  if(typeof session.isAuthenticated!=='boolean'||!Number.isSafeInteger(session.lastUpdate)||session.lastUpdate<0)throw Error('Invalid session state')
  if(session.peerIdentityKey!==undefined)this.text(session.peerIdentityKey)
  const serialized=JSON.stringify(session)
  if(Buffer.byteLength(serialized)>32768)throw Error('Session state exceeds storage limit')
  await this.write(async(db,now)=>{
   if(session.lastUpdate<=now-CHALLENGE_MS||session.lastUpdate>now+30_000)throw Error('Session expired or has an invalid timestamp')
   const previous=(await db.query('SELECT identity_key FROM auth_peer_sessions WHERE session_nonce=$1',[nonce])).rows[0]
   if(previous?.identity_key&&previous.identity_key!==session.peerIdentityKey)throw Error('Session identity cannot change')
   if(!previous&&Number((await db.query('SELECT count(*) AS n FROM auth_peer_sessions')).rows[0].n)>=this.maxSessions)throw Error('Authentication session capacity exhausted')
   await db.query(`INSERT INTO auth_peer_sessions(session_nonce,identity_key,authenticated,authorization_ready,last_update,expires_at,data)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(session_nonce) DO UPDATE SET identity_key=EXCLUDED.identity_key,
    authenticated=EXCLUDED.authenticated,authorization_ready=EXCLUDED.authorization_ready,last_update=EXCLUDED.last_update,expires_at=EXCLUDED.expires_at,data=EXCLUDED.data
    WHERE auth_peer_sessions.last_update<=EXCLUDED.last_update AND (NOT auth_peer_sessions.authenticated OR EXCLUDED.authenticated)`,
    [nonce,session.peerIdentityKey??null,session.isAuthenticated,session.isAuthenticated&&(session.certificatesRequired!==true||session.certificatesValidated===true),session.lastUpdate,session.lastUpdate+CHALLENGE_MS,serialized])
  })
 }
 async updateSession(session:PeerSession):Promise<void>{await this.addSession(session)}
 async getSession(identifier:string):Promise<PeerSession|undefined>{
  this.text(identifier)
  const result=await this.pool.query(`SELECT data FROM auth_peer_sessions WHERE expires_at>$2 AND (session_nonce=$1 OR identity_key=$1)
   ORDER BY (session_nonce=$1) DESC,authenticated DESC,authorization_ready DESC,last_update DESC,session_nonce LIMIT 1`,[identifier,this.time()])
  return result.rows[0]?.data as PeerSession|undefined
 }
 async hasSession(identifier:string):Promise<boolean>{return (await this.getSession(identifier))!==undefined}
 async removeSession(session:PeerSession):Promise<void>{
  if(session.sessionNonce===undefined)return
  const nonce=this.text(session.sessionNonce)
  await this.write(async db=>{await db.query('DELETE FROM auth_peer_sessions WHERE session_nonce=$1',[nonce])})
 }
 async claimMessageNonce(sessionNonce:string,messageNonce:string):Promise<boolean>{
  this.text(sessionNonce);this.text(messageNonce)
  return this.write(async db=>{
   if(!(await db.query('SELECT 1 FROM auth_peer_sessions WHERE session_nonce=$1',[sessionNonce])).rowCount)throw Error('Authentication session not found')
   if((await db.query('SELECT 1 FROM auth_message_nonces WHERE session_nonce=$1 AND nonce=$2',[sessionNonce,messageNonce])).rowCount)return false
   if(Number((await db.query('SELECT count(*) AS n FROM auth_message_nonces WHERE session_nonce=$1',[sessionNonce])).rows[0].n)>=this.maxMessageNonces)throw Error('Session message nonce capacity exhausted')
   await db.query('INSERT INTO auth_message_nonces VALUES($1,$2)',[sessionNonce,messageNonce]);return true
  })
 }
 async claimInitialRequestNonce(identityKey:string,initialNonce:string):Promise<boolean>{
  this.text(identityKey);this.text(initialNonce)
  return this.write(async(db,now)=>{
   if((await db.query('SELECT 1 FROM auth_initial_nonces WHERE identity_key=$1 AND nonce=$2',[identityKey,initialNonce])).rowCount)return false
   // Match the SDK's bounded window for unsigned initial requests: evict the
   // oldest claim rather than letting arbitrary identities exhaust all login.
   if(Number((await db.query('SELECT count(*) AS n FROM auth_initial_nonces WHERE identity_key=$1',[identityKey])).rows[0].n)>=256)
    await db.query('DELETE FROM auth_initial_nonces WHERE (identity_key,nonce) IN (SELECT identity_key,nonce FROM auth_initial_nonces WHERE identity_key=$1 ORDER BY claimed_at,nonce LIMIT 1)',[identityKey])
   if(Number((await db.query('SELECT count(*) AS n FROM auth_initial_nonces')).rows[0].n)>=this.maxInitialNonces)
    await db.query('DELETE FROM auth_initial_nonces WHERE (identity_key,nonce) IN (SELECT identity_key,nonce FROM auth_initial_nonces ORDER BY claimed_at,identity_key,nonce LIMIT 1)')
   await db.query('INSERT INTO auth_initial_nonces VALUES($1,$2,$3)',[identityKey,initialNonce,now]);return true
  })
 }
}
