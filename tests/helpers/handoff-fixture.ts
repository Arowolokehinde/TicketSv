import {PrivateKey,ProtoWallet,PushDrop,Transaction,Utils,MerklePath,type WalletInterface} from '@bsv/sdk'
import {attendeeOfflineFixture} from './attendee-offline-fixture.ts'
import {attendeeEvidence} from '../../src/offline/attendee-evidence.ts'
import {fromAttendee,invitationFor,requestBytes} from '../../src/handoff/evidence.ts'
import {HANDOFF_PROTOCOL,type HandoffRequest,type HandoffTicket} from '../../src/handoff/types.ts'
import {RECEIVE_PROTOCOL,type ReceiveRequest} from '../../src/tickets/types.ts'
import {ticketScript} from '../../src/tickets/script.ts'
export async function handoffFixture(mined=false,origin='http://127.0.0.1:4175'){
 const f=await attendeeOfflineFixture(origin)
 // These are ordinary mined transactions, not the block's coinbase at offset zero.
 f.tx.merklePath=new MerklePath(1762324,[[{offset:1,hash:f.tx.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
 f.record.pkg!.atomicBeefBase64=Utils.toBase64(f.tx.toAtomicBEEF())
 const source=fromAttendee(attendeeEvidence(f.record,f.identity,origin))
 const sender=new ProtoWallet(new PrivateKey(2)),recipient=new ProtoWallet(new PrivateKey(3)),recipientIdentity=(await recipient.getPublicKey({identityKey:true})).publicKey
 const requestId=crypto.randomUUID(),key={protocolID:RECEIVE_PROTOCOL,keyID:requestId,counterparty:'self'}
 const receiving:ReceiveRequest={kind:'ticket-request',version:1,network:'testnet',requestId,recipient:{...key,publicKey:(await recipient.getPublicKey({...key,forSelf:true})).publicKey}}
 const unsigned={kind:'ticketsv-handoff-request' as const,version:1 as const,invitation:invitationFor(source),recipientIdentity,request:receiving},data=requestBytes(unsigned)
 const request:HandoffRequest={...unsigned,keySignature:Utils.toBase64((await recipient.createSignature({...key,data})).signature),identitySignature:Utils.toBase64((await recipient.createSignature({protocolID:HANDOFF_PROTOCOL,keyID:requestId,counterparty:'anyone',data})).signature)}
 const tx=new Transaction(1,[{sourceTransaction:f.tx,sourceOutputIndex:0,sequence:0xffffffff}],[{satoshis:1,lockingScript:ticketScript(source.pkg.issuance.eventId,source.pkg.issuance.ticketId,source.pkg.issuance.origin,receiving)}],0)
 const sk=source.pkg.request.recipient
 tx.inputs[0].unlockingScript=await new PushDrop(sender as unknown as WalletInterface).unlock(sk.protocolID,sk.keyID,sk.counterparty,'all',false).sign(tx,0)
 if(mined)tx.merklePath=new MerklePath(1762324,[[{offset:0,hash:tx.id('hex'),txid:true}]])
 const ticket:HandoffTicket={kind:'ticketsv-handoff-ticket',version:1,origin:source.origin,holder:recipientIdentity,trustedVenue:source.trustedVenue,event:source.event,request,savedAt:new Date().toISOString(),pkg:{...source.pkg,request:receiving,current:{txid:tx.id('hex'),index:0},lineageRawTxs:[...source.pkg.lineageRawTxs,tx.toHex()],atomicBeefBase64:Utils.toBase64(tx.toAtomicBEEF())}}
 return {source,request,ticket,tx,recipient,sender}
}
