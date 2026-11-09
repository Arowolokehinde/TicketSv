import type {Express} from 'express'
import type {Pool} from 'pg'
import type {WalletInterface} from '@bsv/sdk'
import {Utils} from '@bsv/sdk'
import {randomUUID} from 'node:crypto'
import {sessionFor} from './auth.ts'
import {ApiError} from './events.ts'
import {SCANNER_AUTH_PROTOCOL,SCANNER_AUTH_KEY,SCANNER_AUTH_MS,scannerPermitBytes,type ScannerPermit} from '../src/scanner/authorization.ts'
export function scannerAuthorizationRoute(app:Express,pool:Pool,wallet:WalletInterface,now:()=>number){
 app.post('/api/auth/scanner-permit',async(req,res)=>{
  const time=now(),session=await sessionFor(pool,req,res.locals.origin,time)
  if(!session)throw new ApiError(401,'Sign in before preparing offline scanner access.')
  if(req.headers['x-ticketsv-identity']!==session.identityKey)throw new ApiError(409,'The signed-in scanner account changed. Reload before preparing.')
  const permit:ScannerPermit={kind:'ticketsv-scanner-authorization',version:1,scope:'scanner',network:'testnet',origin:res.locals.origin,identityKey:session.identityKey,issuedAt:time,expiresAt:Math.min(Date.parse(session.expiresAt),time+SCANNER_AUTH_MS),nonce:randomUUID(),signature:''}
  permit.signature=Utils.toBase64((await wallet.createSignature({protocolID:SCANNER_AUTH_PROTOCOL,keyID:SCANNER_AUTH_KEY,counterparty:'anyone',data:scannerPermitBytes(permit)})).signature)
  res.json(permit)
 })
}
