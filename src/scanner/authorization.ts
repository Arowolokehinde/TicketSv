import {KeyDeriver,Signature,Utils} from '@bsv/sdk'
import {fromBase64,publicKey} from '../tickets/codec.ts'
import type {AuthSession} from '../auth/api.ts'
export const SCANNER_AUTH_PROTOCOL:[2,string]=[2,'ticketsv scanner authorization']
export const SCANNER_AUTH_KEY='offline-v1'
export const SCANNER_AUTH_MS=8*3600000
export const SCANNER_AUTH_STORAGE='ticketsv-scanner-authorization-v1'
declare const __TICKETSV_AUTH_IDENTITY__:string
export const SCANNER_SERVER_IDENTITY=typeof __TICKETSV_AUTH_IDENTITY__==='string'?__TICKETSV_AUTH_IDENTITY__:''
export type ScannerPermit={kind:'ticketsv-scanner-authorization';version:1;scope:'scanner';network:'testnet';origin:string;identityKey:string;issuedAt:number;expiresAt:number;nonce:string;signature:string}
export function scannerPermitBytes(value:ScannerPermit):number[]{
 if(!value||value.kind!=='ticketsv-scanner-authorization'||value.version!==1||value.scope!=='scanner'||value.network!=='testnet'||typeof value.origin!=='string'||value.origin.length>300||new URL(value.origin).origin!==value.origin||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=value.issuedAt||value.expiresAt-value.issuedAt>SCANNER_AUTH_MS||typeof value.nonce!=='string'||! /^[a-f0-9-]{36}$/.test(value.nonce))throw Error('Invalid scanner authorisation.')
 return Utils.toArray(JSON.stringify({purpose:'Authorise TicketSV offline scanner',kind:value.kind,version:1,scope:'scanner',network:'testnet',origin:value.origin,identityKey:publicKey(value.identityKey),issuedAt:value.issuedAt,expiresAt:value.expiresAt,nonce:value.nonce}),'utf8')
}
export function verifyScannerPermit(value:unknown,context:{origin:string;serverIdentity:string;now?:number}):ScannerPermit{
 if(!value||typeof value!=='object')throw Error('Sign in and prepare this scanner online.')
 const v=value as ScannerPermit,data=scannerPermitBytes(v),now=context.now??Date.now()
 if(v.origin!==context.origin||v.expiresAt<=now||v.issuedAt>now+30000)throw Error('Scanner authorisation expired or belongs to another website. Sign in online and prepare again.')
 const key=new KeyDeriver('anyone').derivePublicKey(SCANNER_AUTH_PROTOCOL,SCANNER_AUTH_KEY,publicKey(context.serverIdentity))
 if(!Signature.fromDER(fromBase64(v.signature,80)).verify(data,key))throw Error('Scanner authorisation signature is invalid.')
 return {kind:v.kind,version:1,scope:'scanner',network:'testnet',origin:v.origin,identityKey:publicKey(v.identityKey),issuedAt:v.issuedAt,expiresAt:v.expiresAt,nonce:v.nonce,signature:v.signature}
}
export function savedScannerPermit():ScannerPermit|null{
 try{return verifyScannerPermit(JSON.parse(localStorage.getItem(SCANNER_AUTH_STORAGE)??'null'),{origin:location.origin,serverIdentity:SCANNER_SERVER_IDENTITY})}catch{return null}
}
export function scannerOfflineSession():AuthSession|null{
 const permit=savedScannerPermit()
 return permit?{identityKey:permit.identityKey,network:'testnet',expiresAt:new Date(permit.expiresAt).toISOString()}:null
}
export function revokeScannerPermit(){try{localStorage.removeItem(SCANNER_AUTH_STORAGE)}catch{/* No ticket or wallet data is removed. */}}
export function saveScannerPermit(value:unknown,identity:string):ScannerPermit{
 const permit=verifyScannerPermit(value,{origin:location.origin,serverIdentity:SCANNER_SERVER_IDENTITY})
 if(permit.identityKey!==identity)throw Error('The signed-in scanner account changed. Prepare again.')
 localStorage.setItem(SCANNER_AUTH_STORAGE,JSON.stringify(permit))
 return permit
}
