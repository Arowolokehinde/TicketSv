import {PrivateKey,ProtoWallet,Transaction,LockingScript,UnlockingScript,MerklePath,PushDrop,Utils} from '@bsv/sdk'
import type {WalletInterface} from '@bsv/sdk'
import {ticketScript,issuanceBytes} from '../../src/tickets/script.ts'
import type {ReceiveRequest,TicketPackage} from '../../src/tickets/types.ts'
import type {ReopeningEvidence} from '../../src/offline/evidence.ts'
// Synthetic signing keys/proofs; never imported by application modules.
export async function conflictFixture(){
 const wallet=new ProtoWallet(new PrivateKey(42)),trusted=(await wallet.getPublicKey({identityKey:true})).publicKey
 const request=async(id:string):Promise<ReceiveRequest>=>({kind:'ticket-request',version:1,network:'testnet',requestId:id,recipient:{publicKey:(await wallet.getPublicKey({protocolID:[2,'counterfoil ticket receiving'],keyID:id,counterparty:'self',forSelf:true})).publicKey,protocolID:[2,'counterfoil ticket receiving'],keyID:id,counterparty:'self'}})
 const source=await request('fixture-source'),a=await request('fixture-a'),b=await request('fixture-b')
 const feeScript=LockingScript.fromASM('OP_TRUE')
 const issuance=new Transaction(1,[],[{satoshis:1,lockingScript:ticketScript('conflict-event','conflict-ticket',null,source)},{satoshis:1000,lockingScript:feeScript},{satoshis:1000,lockingScript:feeScript}])
 issuance.merklePath=new MerklePath(1,[[{offset:1,hash:issuance.id('hex'),txid:true},{offset:0,hash:'11'.repeat(32)}]])
 const origin={txid:issuance.id('hex'),index:0},keyID=`${origin.txid}.0`,protocolID:[2,string]=[2,'counterfoil ticket issuance']
 const data=issuanceBytes('conflict-event','conflict-ticket',origin)
 const signature=(await wallet.createSignature({protocolID,keyID,counterparty:'anyone',data})).signature
 const signingKey=(await wallet.getPublicKey({protocolID,keyID,counterparty:'anyone',forSelf:true})).publicKey
 const base:TicketPackage={kind:'ticket-package',version:1,network:'testnet',issuance:{eventId:'conflict-event',ticketId:'conflict-ticket',origin,issuerIdentity:trusted,signedBytesBase64:Utils.toBase64(data),signatureBase64:Utils.toBase64(signature),signingKey:{publicKey:signingKey,protocolID,keyID,counterparty:'anyone'}},current:origin,request:source,lineageRawTxs:[issuance.toHex()],atomicBeefBase64:Utils.toBase64(issuance.toAtomicBEEF())}
 async function branch(buyer:ReceiveRequest,feeIndex:number):Promise<ReopeningEvidence>{
  const tx=new Transaction(1,[{sourceTransaction:issuance,sourceOutputIndex:0},{sourceTransaction:issuance,sourceOutputIndex:feeIndex,unlockingScript:new UnlockingScript()}],[{satoshis:1,lockingScript:ticketScript('conflict-event','conflict-ticket',origin,buyer)}])
  tx.inputs[0].unlockingScript=await new PushDrop(wallet as unknown as WalletInterface).unlock(source.recipient.protocolID,source.requestId,'self','all',false).sign(tx,0)
  return {kind:'counterfoil-reopening-evidence',version:1,trusted,buyer,pkg:{...base,current:{txid:tx.id('hex'),index:0},request:buyer,lineageRawTxs:[issuance.toHex(),tx.toHex()],atomicBeefBase64:Utils.toBase64(tx.toAtomicBEEF())}}
 }
 return {wallet,trusted,source,base,issuance,a,b,branch,pair:{a:await branch(a,1),b:await branch(b,2)}}
}
