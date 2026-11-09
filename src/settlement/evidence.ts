import {MerklePath,Transaction,Utils} from '@bsv/sdk'
import {readReopeningEvidence,type ReopeningEvidence} from '../offline/evidence.ts'
import {fromBase64,readTicketPackage} from '../tickets/codec.ts'
import {verifyTicket} from '../verification/verifyTicket.ts'
import {validateSnapshot,validateHeader,type HeaderSnapshot} from '../headers/validate.ts'
import type {Verification} from '../tickets/types.ts'
import type {ArcObservation,TransferReview} from './types.ts'
export function transactionSummary(value:ReopeningEvidence):Omit<TransferReview,'snapshotId'>{
 const evidence=readReopeningEvidence(value),pkg=evidence.pkg
 if(pkg.lineageRawTxs.length<2)throw new Error('Load a completed ticket transfer, not an issuance')
 const tx=Transaction.fromAtomicBEEF(fromBase64(pkg.atomicBeefBase64))
 if(tx.id('hex')!==pkg.current.txid||tx.toHex()!==pkg.lineageRawTxs.at(-1))throw new Error('Saved transaction bytes do not match the ticket')
 const amount=(n:unknown):number=>{if(!Number.isSafeInteger(n)||(n as number)<0)throw new Error('Invalid transaction amount');return n as number}
 const inputs=tx.inputs.map(i=>{
  const parent=i.sourceTransaction
  if(!parent?.merklePath)throw new Error('Unsupported unmined ancestor or missing immediate input evidence')
  const id=parent.id('hex');if(i.sourceTXID&&i.sourceTXID!==id)throw new Error('Input transaction mismatch')
  return {txid:id,index:i.sourceOutputIndex,satoshis:amount(parent.outputs[i.sourceOutputIndex]?.satoshis)}
 })
 const outputs=tx.outputs.map((o,index)=>({index,satoshis:amount(o.satoshis)}))
 const total=(items:{satoshis:number}[])=>items.reduce((n,x)=>n+BigInt(x.satoshis),0n)
 const fee=total(inputs)-total(outputs);if(fee<0n||fee>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Invalid transaction fee')
 return {txid:pkg.current.txid,rawHex:tx.toHex(),efHex:tx.toHexEF(),rawBytes:tx.toBinary().length,fee:Number(fee),inputs,outputs,evidence}
}
export async function reviewTransfer(value:ReopeningEvidence,snapshot:HeaderSnapshot|undefined):Promise<TransferReview>{
 const evidence=readReopeningEvidence(value)
 const result=await verifyTicket(evidence.pkg,{trustedVenueIdentity:evidence.trusted,expectedRequest:evidence.buyer,snapshot})
 if(result.verdict!=='verified')throw new Error(`Transfer verification ${result.verdict}: ${result.checks.filter(c=>c.status!=='pass').map(c=>c.reason).join('; ')}`)
 if(!snapshot)throw new Error('Local headers missing')
 return {...transactionSummary(evidence),snapshotId:validateSnapshot(snapshot).id}
}
function subjectProof(o:ArcObservation):MerklePath{
 if(o.txStatus!=='MINED'&&o.txStatus!=='IMMUTABLE')throw new Error('Provider has not reported current mining')
 if(!o.merklePath||!o.blockHash||!o.blockHeight)throw new Error('Mining proof or block details not available yet')
 const proof=MerklePath.fromHex(o.merklePath)
 if(proof.toHex().length!==o.merklePath.length||proof.blockHeight!==o.blockHeight)throw new Error('Mining proof height or encoding mismatch')
 if(!proof.path[0].some(leaf=>leaf.hash===o.txid&&!leaf.duplicate))throw new Error('Mining proof does not contain the subject transaction')
 proof.computeRoot(o.txid)
 return proof
}
export function verifyMiningAnchor(o:ArcObservation,snapshot:HeaderSnapshot|undefined):boolean{
 const proof=subjectProof(o)
 if(!snapshot)return false
 const header=validateSnapshot(snapshot).headers.find(h=>h.height===proof.blockHeight)
 if(!header)return false
 if(header.hash!==o.blockHash)throw new Error('Reported mining block does not match local headers')
 if(validateHeader(header.hex).merkleRoot!==proof.computeRoot(o.txid))throw new Error('Mining Merkle root does not match local headers')
 return true
}
export function minedCandidate(value:ReopeningEvidence,o:ArcObservation):ReopeningEvidence{
 const evidence=readReopeningEvidence(value)
 if(evidence.pkg.current.txid!==o.txid)throw new Error('Mining proof is for another transaction')
 const tx=Transaction.fromAtomicBEEF(fromBase64(evidence.pkg.atomicBeefBase64)),before=tx.toHex()
 tx.merklePath=subjectProof(o)
 const pkg=readTicketPackage(JSON.stringify({...evidence.pkg,atomicBeefBase64:Utils.toBase64(tx.toAtomicBEEF())}))
 const after=Transaction.fromAtomicBEEF(fromBase64(pkg.atomicBeefBase64))
 if(after.id('hex')!==pkg.current.txid||after.toHex()!==before)throw new Error('Proof changed the signed transaction')
 return {...evidence,pkg}
}
export async function verifyMinedCandidate(value:ReopeningEvidence,o:ArcObservation,snapshot:HeaderSnapshot|undefined):Promise<Verification>{
 const candidate=minedCandidate(value,o)
 const anchored=verifyMiningAnchor(o,snapshot)
 const result=await verifyTicket(candidate.pkg,{trustedVenueIdentity:candidate.trusted,expectedRequest:candidate.buyer,snapshot})
 if(!anchored&&result.verdict!=='rejected')return {...result,verdict:'incomplete',presentedTransferMined:false}
 return result
}
