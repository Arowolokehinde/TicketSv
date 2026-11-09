import {PrivateKey,ProtoWallet,Transaction,LockingScript,UnlockingScript,MerklePath,PushDrop,Utils} from '@bsv/sdk'
import type {WalletInterface} from '@bsv/sdk'
import {ticketScript,issuanceBytes} from '../../src/tickets/script.ts'
import type {ReceiveRequest,TicketPackage} from '../../src/tickets/types.ts'

// Synthetic keys/anchors ONLY. Never used by the application or presented as live evidence.
export async function ticketFixture(buyerRequestId='buyer-request'){
 const wallet=new ProtoWallet(new PrivateKey(1))
 const identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const request=async(requestId:string):Promise<ReceiveRequest>=>({kind:'ticket-request',version:1,network:'testnet',requestId,recipient:{publicKey:(await wallet.getPublicKey({protocolID:[2,'counterfoil ticket receiving'],keyID:requestId,counterparty:'self',forSelf:true})).publicKey,protocolID:[2,'counterfoil ticket receiving'],keyID:requestId,counterparty:'self'}})
 const source=await request('source-request'),destination=await request(buyerRequestId)
 const funding=new Transaction(1,[],[{satoshis:100,lockingScript:LockingScript.fromASM('OP_TRUE')}]);funding.merklePath=new MerklePath(1,[[{offset:1,hash:funding.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
 const issue=new Transaction(1,[{sourceTransaction:funding,sourceOutputIndex:0,unlockingScript:new UnlockingScript()}],[{satoshis:1,lockingScript:ticketScript('event','ticket',null,source)}])
 const origin={txid:issue.id('hex'),index:0}
 const signed=issuanceBytes('event','ticket',origin)
 const keyID=`${origin.txid}.0`
 const signature=(await wallet.createSignature({protocolID:[2,'counterfoil ticket issuance'],keyID,counterparty:'anyone',data:signed})).signature
 const signingKey=(await wallet.getPublicKey({protocolID:[2,'counterfoil ticket issuance'],keyID,counterparty:'anyone',forSelf:true})).publicKey
 const transfer=new Transaction(1,[{sourceTransaction:issue,sourceOutputIndex:0,unlockingScript:new UnlockingScript()}],[{satoshis:1,lockingScript:ticketScript('event','ticket',origin,destination)}])
 transfer.inputs[0].unlockingScript=await new PushDrop(wallet as unknown as WalletInterface).unlock([2,'counterfoil ticket receiving'],source.requestId,'self','all',false).sign(transfer,0)
 const pkg:TicketPackage={kind:'ticket-package',version:1,network:'testnet',issuance:{eventId:'event',ticketId:'ticket',origin,issuerIdentity:identity,signedBytesBase64:Utils.toBase64(signed),signatureBase64:Utils.toBase64(signature),signingKey:{publicKey:signingKey,protocolID:[2,'counterfoil ticket issuance'],keyID,counterparty:'anyone'}},current:{txid:transfer.id('hex'),index:0},request:destination,lineageRawTxs:[issue.toHex(),transfer.toHex()],atomicBeefBase64:Utils.toBase64(transfer.toAtomicBEEF())}
 return {wallet,identity,source,destination,issue,transfer,pkg}
}
