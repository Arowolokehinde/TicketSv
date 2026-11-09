import {KeyDeriver,Signature,Spend,Transaction,Utils} from '@bsv/sdk'
import type {TicketPackage,ReceiveRequest} from '../tickets/types.ts'
import {ISSUER_PROTOCOL} from '../tickets/types.ts'
import {fromBase64,publicKey,readReceiveRequest} from '../tickets/codec.ts'
import {issuanceBytes,decodeTicket} from '../tickets/script.ts'
export function verifyIssuer(pkg:TicketPackage,trustedVenueIdentity:string):void{
 if(pkg.issuance.issuerIdentity!==publicKey(trustedVenueIdentity))throw new Error('Ticket was not signed by the trusted venue identity')
 const i=pkg.issuance,data=issuanceBytes(i.eventId,i.ticketId,i.origin),keyID=`${i.origin.txid}.${i.origin.index}`
 if(Utils.toBase64(data)!==i.signedBytesBase64)throw new Error('Signed issuance fields do not match the exact canonical record')
 // "anyone" is the SDK public-verification convention, not a wallet private key.
 const expected=new KeyDeriver('anyone').derivePublicKey(ISSUER_PROTOCOL,keyID,trustedVenueIdentity)
 if(i.signingKey.publicKey!==expected.toString()||JSON.stringify(i.signingKey.protocolID)!==JSON.stringify(ISSUER_PROTOCOL)||i.signingKey.keyID!==keyID||i.signingKey.counterparty!=='anyone')throw new Error('Issuance signing key is not derived from the trusted venue')
 if(!Signature.fromDER(fromBase64(i.signatureBase64,80)).verify(data,expected))throw new Error('Venue signature is invalid')
}
export function lineageTransactions(pkg:TicketPackage):Transaction[]{return pkg.lineageRawTxs.map(raw=>{const tx=Transaction.fromHex(raw);if(tx.toHex()!==raw)throw new Error('Retained transaction bytes are not canonical');return tx})}
export function verifyContinuity(pkg:TicketPackage):void{
 const txs=lineageTransactions(pkg),seen=new Set<string>();let previous:Transaction|undefined;let previousIndex=pkg.issuance.origin.index
 for(let n=0;n<txs.length;n++){
  const tx=txs[n],id=tx.id('hex');if(seen.has(id))throw new Error('Duplicated or cyclic ticket lineage');seen.add(id)
  const matches=tx.outputs.flatMap((o,index)=>{const d=decodeTicket(o.lockingScript);return d&&d.eventId===pkg.issuance.eventId&&d.ticketId===pkg.issuance.ticketId?[{index,decoded:d}]:[]})
  if(matches.length!==1)throw new Error('Expected exactly one recognized ticket successor output')
  const {index,decoded}=matches[0]
  if(tx.outputs[index].satoshis!==1)throw new Error('Ticket output value changed')
  if(n===0){if(id!==pkg.issuance.origin.txid||index!==pkg.issuance.origin.index||decoded.origin!==null)throw new Error('Issuance does not match the signed original outpoint')}
  else{
   if(JSON.stringify(decoded.origin)!==JSON.stringify(pkg.issuance.origin))throw new Error('Ticket origin reference changed')
   const positions=tx.inputs.flatMap((input,j)=>input.sourceTXID===previous!.id('hex')&&input.sourceOutputIndex===previousIndex?[j]:[])
   if(positions.length!==1)throw new Error('Broken ticket lineage: preceding outpoint is not spent exactly once')
   const j=positions[0],input=tx.inputs[j],source=previous!.outputs[previousIndex]
   if(!input.unlockingScript)throw new Error('Retained ticket input signature is missing')
   try{if(!new Spend({sourceTXID:previous!.id('hex'),sourceOutputIndex:previousIndex,sourceSatoshis:source.satoshis!,lockingScript:source.lockingScript,transactionVersion:tx.version,otherInputs:tx.inputs.filter((_,k)=>k!==j),outputs:tx.outputs,inputIndex:j,unlockingScript:input.unlockingScript,inputSequence:input.sequence??0xffffffff,lockTime:tx.lockTime}).validate())throw new Error('invalid')}
   catch{throw new Error('Retained ticket input signature/script is invalid')}
  }
  previous=tx;previousIndex=index
 }
 if(!previous||previous.id('hex')!==pkg.current.txid||previousIndex!==pkg.current.index)throw new Error('Current outpoint does not match retained ticket lineage')
}
export function verifyRecipient(pkg:TicketPackage,expected:ReceiveRequest):void{
 const request=readReceiveRequest(JSON.stringify(expected))
 if(JSON.stringify(pkg.request)!==JSON.stringify(request))throw new Error('Package does not match the independently saved receiving request')
 const tx=lineageTransactions(pkg).at(-1)!,output=tx.outputs[pkg.current.index],decoded=output?decodeTicket(output.lockingScript):undefined
 if(!decoded||decoded.publicKey!==request.recipient.publicKey||decoded.requestId!==request.requestId)throw new Error('Actual ticket recipient lock/request does not match the saved request')
}
