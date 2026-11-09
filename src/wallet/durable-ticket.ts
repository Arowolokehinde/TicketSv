import {Beef,Transaction,Utils} from '@bsv/sdk'
import type {WalletInterface} from '@bsv/sdk'
import {fromBase64,readReceiveRequest,readTicketPackage} from '../tickets/codec.ts'
import type {ReceiveRequest,TicketPackage} from '../tickets/types.ts'
import type {HeaderSnapshot} from '../headers/validate.ts'
import {readSigningEvidenceBytes,verifySigningEvidence} from '../verification/signing-spv.ts'
import {confirmIssuanceRequest,type TicketPreparation} from './ticket-experiment.ts'
type Reader=Pick<WalletInterface,'getNetwork'|'getPublicKey'|'listOutputs'>
export async function refreshIssuanceEvidence(wallet:Reader,value:TicketPackage,trusted:string):Promise<TicketPackage>{
 const pkg=readTicketPackage(JSON.stringify(value))
 await confirmIssuanceRequest(wallet,pkg,trusted)
 const result=await wallet.listOutputs({basket:'counterfoil-ticket-experiment',include:'entire transactions',limit:1000})
 await confirmIssuanceRequest(wallet,pkg,trusted)
 if(!Number.isSafeInteger(result.totalOutputs)||result.totalOutputs>1000||result.totalOutputs!==result.outputs.length)throw new Error('Incomplete wallet output listing; review wallet state')
 const matches=result.outputs.filter(o=>o.outpoint===`${pkg.current.txid}.${pkg.current.index}`)
 if(matches.length!==1||matches[0].spendable!==true||matches[0].satoshis!==1||!result.BEEF)throw new Error('Ticket is not available with full wallet evidence')
 const beef=Beef.fromBinary(result.BEEF)
 if(beef.txs.length>128||!beef.isValid(false))throw new Error('Wallet returned incomplete BEEF')
 const bytes=beef.toBinaryAtomic(pkg.current.txid),tx=Transaction.fromAtomicBEEF(bytes)
 if(tx.toHex()!==pkg.lineageRawTxs[0])throw new Error('Wallet changed the issuance transaction')
 if(!tx.merklePath)throw new Error('Issuance mining proof is not available yet; check again after mining')
 readSigningEvidenceBytes(pkg.current.txid,bytes)
 return readTicketPackage(JSON.stringify({...pkg,atomicBeefBase64:Utils.toBase64(bytes)}))
}
export async function prepareMinedTransfer(wallet:Reader,value:TicketPackage,buyer:ReceiveRequest,trusted:string,snapshot:HeaderSnapshot|undefined):Promise<TicketPreparation>{
 const pkg=await refreshIssuanceEvidence(wallet,value,trusted)
 const report=await verifySigningEvidence(readSigningEvidenceBytes(pkg.current.txid,fromBase64(pkg.atomicBeefBase64)),snapshot)
 if(!report.subjectMined)throw new Error('Locally verified mined issuance is required')
 const source=await confirmIssuanceRequest(wallet,pkg,trusted),destination=readReceiveRequest(JSON.stringify(buyer))
 if(destination.requestId===source.requestId||destination.recipient.publicKey===source.recipient.publicKey)throw new Error('Buyer must use a different prepared receiving key')
 const key=await wallet.getPublicKey({protocolID:destination.recipient.protocolID,keyID:destination.recipient.keyID,counterparty:destination.recipient.counterparty,forSelf:true})
 if(key.publicKey!==destination.recipient.publicKey)throw new Error('Saved buyer request does not match this wallet')
 await confirmIssuanceRequest(wallet,pkg,trusted)
 // Confirmed issuance is not a member of an old noSend batch. Fee allocation
 // belongs to the new transfer; its offline availability still needs a live test.
 return {pkg,source,destination,noSendChange:[]}
}

// Explicit operator review only. Never signs, submits, imports or cancels.
export async function recoverMinedSourcePreflight(wallet:Reader,value:import('../tickets/experiment-store.ts').ExperimentRecord,snapshot:HeaderSnapshot|undefined){
 const {readExperiment,canReviewMinedSourceFailure}=await import('../tickets/experiment-store.ts')
 const record=readExperiment(value)
 if(!canReviewMinedSourceFailure(record))throw new Error('This wallet outcome requires manual review; recovery is unavailable')
 const preparation=await prepareMinedTransfer(wallet,record.pkg!,record.buyer!,record.trusted,snapshot)
 return {preparation,record:readExperiment({...record,revision:record.revision+1,pkg:preparation.pkg,
  recoveredPreflight:{attempt:record.attempt,failure:record.failure,at:new Date().toISOString()},failure:undefined,
  attempt:{id:crypto.randomUUID(),phase:'issue',status:'complete',at:new Date().toISOString()}})}
}
