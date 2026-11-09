import {LockingScript,OP,PushDrop,Utils} from '@bsv/sdk'
import {identifier,publicKey} from './codec.ts'
import type {Outpoint,ReceiveRequest} from './types.ts'
export function issuanceBytes(eventId:string,ticketId:string,origin:Outpoint):number[]{return [...new TextEncoder().encode(JSON.stringify(['offline-ticket-issuance',1,'testnet',identifier(eventId),identifier(ticketId),origin.txid,origin.index]))]}
export function ticketScript(eventId:string,ticketId:string,origin:Outpoint|null,request:ReceiveRequest):LockingScript{
 const data=[...new TextEncoder().encode(JSON.stringify(['offline-ticket',1,'testnet',identifier(eventId),identifier(ticketId),origin?.txid??null,origin?.index??null,identifier(request.requestId)]))]
 return new LockingScript().writeBin(Utils.toArray(publicKey(request.recipient.publicKey),'hex')).writeOpCode(OP.OP_CHECKSIG).writeBin(data).writeOpCode(OP.OP_DROP) as LockingScript
}
export function decodeTicket(script:LockingScript):{eventId:string;ticketId:string;origin:Outpoint|null;requestId:string;publicKey:string}|undefined{
 let decoded:ReturnType<typeof PushDrop.decode>,row:unknown
 try{decoded=PushDrop.decode(script);if(decoded.fields.length!==1)return;row=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(decoded.fields[0])))}catch{return}
 if(!Array.isArray(row)||row.length!==8||row[0]!=='offline-ticket'||row[1]!==1||row[2]!=='testnet')return
 const eventId=identifier(row[3]),ticketId=identifier(row[4]),requestId=identifier(row[7]),key=publicKey(decoded.lockingPublicKey.toString())
 let origin:Outpoint|null=null
 if(row[5]!==null||row[6]!==null){if(typeof row[5]!=='string'||!/^[0-9a-f]{64}$/.test(row[5])||!Number.isSafeInteger(row[6])||row[6]<0||row[6]>0xffffffff)throw new Error('Invalid ticket origin');origin={txid:row[5],index:row[6]}}
 const request:ReceiveRequest={kind:'ticket-request',version:1,network:'testnet',requestId,recipient:{publicKey:key,protocolID:[2,'counterfoil ticket receiving'],keyID:requestId,counterparty:'self'}}
 if(ticketScript(eventId,ticketId,origin,request).toHex()!==script.toHex())throw new Error('Noncanonical or altered ticket locking script')
 return {eventId,ticketId,origin,requestId,publicKey:key}
}
