import {PublicKey,Utils} from '@bsv/sdk'
import type {Outpoint,KeyBinding,ReceiveRequest,TicketPackage} from './types.ts'
import {RECEIVE_PROTOCOL} from './types.ts'
export const MAX_PACKAGE_BYTES=4*1024*1024
function fail():never{throw new Error('Invalid ticket package or receiving request')}
function object(v:unknown):Record<string,unknown>{if(!v || typeof v!=='object' || Array.isArray(v))fail();return v as Record<string,unknown>}
export function identifier(v:unknown):string{if(typeof v!=='string'|| !v.length||[...v].length>128 || new TextDecoder().decode(new TextEncoder().encode(v))!==v)fail();return v}
export function publicKey(v:unknown):string{if(typeof v!=='string'||!/^(02|03)[0-9a-f]{64}$/.test(v))fail();try{if(!PublicKey.fromString(v).validate())fail()}catch{fail()}return v}
function outpoint(v:unknown):Outpoint{const o=object(v);if(typeof o.txid!=='string'||!/^[0-9a-f]{64}$/.test(o.txid)||!Number.isSafeInteger(o.index)||(o.index as number)<0||(o.index as number)>0xffffffff)fail();return {txid:o.txid,index:o.index as number}}
export function fromBase64(v:unknown,max=MAX_PACKAGE_BYTES):number[]{if(typeof v!=='string'||!v.length||v.length>max*2||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v))fail();const bytes=Utils.toArray(v,'base64');if(bytes.length>max||Utils.toBase64(bytes)!==v)fail();return bytes}
function binding(v:unknown):KeyBinding{const k=object(v);if(!Array.isArray(k.protocolID)||k.protocolID.length!==2||k.protocolID[0]!==2||typeof k.protocolID[1]!=='string'||k.protocolID[1].length>100||typeof k.keyID!=='string'||!k.keyID.length||k.keyID.length>200||typeof k.counterparty!=='string')fail();return {publicKey:publicKey(k.publicKey),protocolID:[2,k.protocolID[1]],keyID:k.keyID,counterparty:k.counterparty}}
function request(v:unknown):ReceiveRequest{const r=object(v);if(r.kind!=='ticket-request'||r.version!==1||r.network!=='testnet')fail();const requestId=identifier(r.requestId),recipient=binding(r.recipient);if(JSON.stringify(recipient.protocolID)!==JSON.stringify(RECEIVE_PROTOCOL)||recipient.counterparty!=='self'||recipient.keyID!==requestId)fail();return {kind:'ticket-request',version:1,network:'testnet',requestId,recipient}}
function parse(text:string):unknown{if(typeof text!=='string'||text.length>MAX_PACKAGE_BYTES||new TextEncoder().encode(text).length>MAX_PACKAGE_BYTES)throw new Error('Ticket envelope exceeds 4 MiB limit');return JSON.parse(text)}
export function readReceiveRequest(text:string):ReceiveRequest{return request(parse(text))}
export function readTicketPackage(text:string):TicketPackage{
 const p=object(parse(text));if(p.kind!=='ticket-package'||p.version!==1||p.network!=='testnet')fail()
 const i=object(p.issuance);fromBase64(i.signedBytesBase64,4096);fromBase64(i.signatureBase64,80);fromBase64(p.atomicBeefBase64)
 if(!Array.isArray(p.lineageRawTxs)||p.lineageRawTxs.length<1||p.lineageRawTxs.length>101||!p.lineageRawTxs.every(raw=>typeof raw==='string'&&raw.length>0&&/^(?:[0-9a-f]{2})+$/.test(raw)))throw new Error('Retain issuance and at most 100 ticket transfers')
 return {kind:'ticket-package',version:1,network:'testnet',issuance:{eventId:identifier(i.eventId),ticketId:identifier(i.ticketId),origin:outpoint(i.origin),issuerIdentity:publicKey(i.issuerIdentity),signedBytesBase64:i.signedBytesBase64 as string,signatureBase64:i.signatureBase64 as string,signingKey:binding(i.signingKey)},current:outpoint(p.current),request:request(p.request),lineageRawTxs:[...p.lineageRawTxs] as string[],atomicBeefBase64:p.atomicBeefBase64 as string}
}
